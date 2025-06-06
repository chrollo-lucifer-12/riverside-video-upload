import express from "express"
import cors from "cors"
import path from "path"
import multer from "multer"
import ffmpeg from "ffmpeg"
import fs from "fs"

const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage()
const upload = multer({storage})

app.use(upload.single("file"))

const ROOT_DIR = path.resolve(__dirname, "..");

const tempDir = path.join(ROOT_DIR, "temp");
const outputDir = path.join(ROOT_DIR, "output");

app.post("/api/v1/upload", (req, res) => {
    const file = req.file;
    const videoId = req.body.videoId;
    try {


        const inputPath = path.join(tempDir, `${file?.originalname}`)
        const outputPath = path.join(outputDir, `${file?.originalname}-${videoId}-360.mp4`);

        fs.writeFileSync(inputPath, file?.buffer!)
        fs.mkdirSync(path.dirname(outputPath), {recursive : true})




        res.status(200).json({message : "Uploaded"})
    } catch (e) {
        console.log(e);
        res.status(500).json({message : "Something went wrong"})
    }
})

app.listen(4000, () => {
    console.log("server running on 4000")
})