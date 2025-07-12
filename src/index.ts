import express from "express"
import cors from "cors"
import multer from "multer"
import { Queue, Worker } from 'bullmq'
import fs from "fs"
import path from "path"
import { exec } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from '@ffprobe-installer/ffprobe';
import {supabase} from "./supabaseClient"

const getContentType = (filename: string) => {
    if (filename.endsWith('.aac')) return 'audio/aac';
    if (filename.endsWith('.mp4')) return 'video/mp4';
    return 'application/octet-stream';
};

const uploadToSupabase = async (filePath: string, bucketName: string, destFileName: string, videoId : string) => {
    const fileBuffer = fs.readFileSync(filePath);
    const contentType = getContentType(destFileName);

    const { error, data } = await supabase.storage
        .from(bucketName)
        .upload(destFileName, fileBuffer, {
            contentType: contentType,
            upsert: true
        });

    if (error) {
        console.error(`❌ Failed to upload ${destFileName}:`, error.message);
    } else {
        console.log(`✅ Uploaded ${destFileName} to Supabase`);
        const { data } = supabase.storage.from(bucketName).getPublicUrl(destFileName);
        await supabase.from("VideoAssets").insert([
            {
                type : contentType == "audio/aac" ? "AUDIO" : "VIDEO",
                url : data.publicUrl,
                mediaId : videoId
            }
        ])
    }
};

const updateMetadata = async (filePath : string, bucketName : string, destFileName : string, videoId : string, type : "preview_url" | "full_url") => {
    const fileBuffer = fs.readFileSync(filePath);
    const contentType = getContentType(destFileName);

    const { error, data } = await supabase.storage
        .from(bucketName)
        .upload(destFileName, fileBuffer, {
            contentType: contentType,
            upsert: true
        });

    if (error) {
        console.error(`❌ Failed to upload ${destFileName}:`, error.message);
    } else {
        console.log(`✅ Uploaded ${destFileName} to Supabase`);
        const { data } = supabase.storage.from(bucketName).getPublicUrl(destFileName);
        await supabase
            .from("Metadata")
            .update({ [type]: data.publicUrl })
            .eq("mediaId", videoId);
    }
}

const execPromise = promisify(exec);

const uploadQueue = new Queue('video-upload', {
    connection : {url : "redis://localhost:6379"},
    defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
    },
});

const uploadWorker = new Worker("video-upload", async (job) => {
    const { fileBuffer, mimetype, videoId } = job.data;

    try {
        const tempDir = path.join(__dirname, "..", "temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        const tempFilePath = path.join(tempDir, `${videoId}.mp4`);
        fs.writeFileSync(tempFilePath, Buffer.from(fileBuffer.data));

        const { stdout } = await execPromise(
            `"${ffprobePath.path}" -v quiet -print_format json -show_streams "${tempFilePath}"`
        );

        const metadata = JSON.parse(stdout);

        const audioStreams = metadata.streams.filter((s: any) => s.codec_type === 'audio');
        const videoStreams = metadata.streams.filter((s: any) => s.codec_type === 'video');

        const bucket = 'uploads';

        for (let i = 0; i < audioStreams.length; i++) {
            const out = `track${i}.aac`;
            const cmd = `"${ffmpegPath}" -i "${tempFilePath}" -map 0:a:${i} -c copy "${out}"`;
            await execPromise(cmd);
            await uploadToSupabase(out, bucket, `audio/${videoId}/track${i}.aac`, videoId);
            console.log(`✅ Extracted audio track ${i} → ${out}`);
        }

        for (let i = 0; i < videoStreams.length; i++) {
            const audioIndex = i < audioStreams.length ? i : 0;
            const out = `combined_track${i}.mp4`;
            const cmd = `"${ffmpegPath}" -i "${tempFilePath}" -map 0:v:${i} -map 0:a:${audioIndex} -c copy "${out}"`;
            await execPromise(cmd);
            await uploadToSupabase(out, bucket, `combined/${videoId}/combined_track${i}.mp4`, videoId);
            console.log(`✅ Extracted video+audio track ${i} → ${out}`);
        }

        const previewOut = path.join(tempDir, `preview_360p.mp4`);
        await execPromise(
            `"${ffmpegPath}" -i "${tempFilePath}" -vf "scale=640:-2" -c:a aac -b:a 128k -c:v libx264 -preset fast "${previewOut}"`
        );
        await updateMetadata(previewOut, bucket, `previews/${videoId}.mp4`, videoId, "preview_url");
        console.log(`🎞️ Transcoded preview → ${previewOut}`);

        const fullOut = path.join(tempDir, `full_1080p.mp4`);
        await execPromise(
            `"${ffmpegPath}" -i "${tempFilePath}" -vf "scale=1920:-2" -c:a aac -b:a 192k -c:v libx264 -preset slow "${fullOut}"`
        );
        await updateMetadata(fullOut, bucket, `full/${videoId}.mp4`, videoId, "full_url");
        console.log(`📽️ Transcoded full HD → ${fullOut}`);


        await supabase.from("Media").update({
            isProcessing : false
        }).eq("id", videoId)

    } catch (e) {
        console.log(e);
    }
}, {connection : {url : "redis://localhost:6379"}})

uploadWorker.on('completed', (job) => {
    console.log(`Upload job ${job.id} completed successfully`);
});

uploadWorker.on('failed', (job, err) => {
    console.error(`Upload job ${job!.id} failed:`, err);
});

uploadWorker.on('progress', (job, progress) => {
    console.log(`Upload job ${job.id} progress: ${progress}%`);
});



const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage()
const upload = multer({storage})

app.use(upload.single("file"))

app.post("/api/v1/upload", async (req, res) => {
    const file = req.file;
    const videoId = req.body.videoId;

    try {
        const job = await uploadQueue.add('process-upload', {
            fileBuffer: file?.buffer!,
            mimetype: file?.mimetype,
            videoId: videoId,
        }, {
            priority: 10,
            delay: 0,
        });

        res.status(200).json({message : "Uploaded"})
        return
    } catch (e) {
        console.log(e);
        res.status(500).json({message : "Something went wrong"})
        return
    }
})

app.listen(4000, () => {
    console.log("server running on 4000")
})