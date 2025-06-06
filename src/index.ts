import express from "express"
import cors from "cors"
import multer from "multer"
import dotenv from "dotenv"
import {Upload} from "tus-js-client"
dotenv.config()


const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage()
const upload = multer({storage})
const projectId = process.env.PROJECT_ID!
const supabaseAnonKey = process.env.ANON_KEY!

app.use(upload.single("file"))

app.post("/api/v1/upload", async (req, res) => {
    const file = req.file;
    const videoId = req.body.videoId;

    try {

        const upload = new Upload(file?.buffer!, {
            endpoint: `https://${projectId}.supabase.co/storage/v1/upload/resumable`,
            headers: {
                'x-upsert': 'true',
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'apikey': supabaseAnonKey,
            },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            metadata: {
                bucketName : "uploads",
                objectName: file?.originalname!,
                contentType: file?.mimetype!,
                cacheControl: "3600",
            },
            chunkSize: 6 * 1024 * 1024,
            onProgress: (uploaded, total) => {
                console.log(`Progress: ${((uploaded / total) * 100).toFixed(2)}%`)
            },
        })
        const previousUploads = await upload.findPreviousUploads()
        if (previousUploads.length) {
            upload.resumeFromPreviousUpload(previousUploads[0])
        }

        upload.start()


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