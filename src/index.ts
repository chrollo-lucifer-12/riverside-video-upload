import express from "express"
import cors from "cors"
import multer from "multer"
import dotenv from "dotenv"
import {Upload} from "tus-js-client"
dotenv.config()
import axios from "axios"

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

        const uploadUrl = await mux.video.uploads.create({
            new_asset_settings: {
                playback_policies: ["public"],
                video_quality: 'basic',
            },
            cors_origin: "*"
        })

        const uploadResponse = await axios.put(uploadUrl.url, file?.buffer, {
            headers: {
                'Content-Type': file?.mimetype
            }
        });

        console.log(uploadResponse);

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