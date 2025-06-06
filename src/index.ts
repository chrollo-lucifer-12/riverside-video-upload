import express from "express"
import cors from "cors"

import multer from "multer"

const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage()
const upload = multer({storage})

app.use(upload.single("file"))

app.post("/api/v1/upload", (req, res) => {
    try {
        const file = req.file;
        const videoId = req.body.videoId;
        console.log(videoId);



        res.status(200).json({message : "Uploaded"})
    } catch (e) {
        console.log(e);
        res.status(500).json({message : "Something went wrong"})
    }
})

app.listen(4000, () => {
    console.log("server running on 4000")
})