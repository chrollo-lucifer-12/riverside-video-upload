import express from "express"
import cors from "cors"
import multer from "multer"
import { Queue, Worker } from 'bullmq'
import axios from "axios"
import fs from "fs"
import path from "path"
import Mux from '@mux/mux-node';

import {uploadUrl,secretKey,muxTokenId} from "./config"


const mux = new Mux({
    tokenId: muxTokenId,
    tokenSecret: secretKey
});


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

        const upload = await mux.video.uploads.create({
            new_asset_settings : {playback_policies : ["public"], video_quality : "plus"},
            cors_origin : "*"
        })

        const fileStream = fs.createReadStream(tempFilePath);
        const fileStats = fs.statSync(tempFilePath);

        const uploadResponse = await axios.put(upload.url, fileStream, {
            headers : {
                'Content-Length': fileStats.size,
                'Content-Type': mimetype
            }
        })

        console.log('File uploaded successfully');

        const startTime = Date.now();
        while (Date.now() - startTime < 300000) {
            const retrieveUpload = await mux.video.uploads.retrieve(upload.id);
            if (retrieveUpload.asset_id) {
                const asset = await mux.video.assets.retrieve(retrieveUpload.asset_id);
                if (asset.status === "ready") {
                    const playBackIds = asset.playback_ids;
                    if (playBackIds) {
                        const playbackUrl = `https://stream.mux.com/${playBackIds[0].id}.m3u8`
                        const thumbnailUrl = `https://image.mux.com/${playBackIds[0].id}/thumbnail.jpg`;

                        await axios.post(uploadUrl!, {
                            playbackUrl, thumbnailUrl,videoId
                        })

                        break;
                    }
                }
                else {
                    console.log("asset status",asset.status);
                }
            }
            else {
                console.log("upload status",retrieveUpload.status);
            }
        }

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

     //   fs.writeFileSync("debug.mp4", file?.buffer!)

    //   console.log("First 4 bytes:", fileBuffer?.slice(0, 4));

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