import express from "express"
import cors from "cors"
import multer from "multer"
import dotenv from "dotenv"
import { Queue, Worker } from 'bullmq'
dotenv.config()
import axios from "axios"


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
        const uploadUrl = await mux.video.uploads.create({
            new_asset_settings: {
                playback_policies: ["public"],
                video_quality: 'basic',
            },
            cors_origin: "*"
        })

        const uploadResponse = await axios.put(uploadUrl.url, fileBuffer, {
            headers: {
                'Content-Type': mimetype
            }
        });

        const upload = await mux.video.uploads.retrieve(uploadUrl.id);
        const asset = await mux.video.assets.retrieve(upload.asset_id!);
        const playbackId = asset.playback_ids?.[0]?.id;
        const playbackUrl = playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null;
        const thumbnailUrl = playbackId ? `https://image.mux.com/${playbackId}/thumbnail.png` : null;
        console.log(playbackUrl , thumbnailUrl);
        // await axios.post("http://localhost:3000/api/update-video", {
        //     playbackUrl, thumbnailUrl
        // })
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

import Mux from '@mux/mux-node';
const mux = new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_SECRET_KEY
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
            fileBuffer: Array.from(file?.buffer!),
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