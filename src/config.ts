import dotenv from "dotenv"
dotenv.config()


const muxTokenId = process.env.MUX_TOKEN_ID
const secretKey = process.env.MUX_SECRET_KEY
const uploadUrl = process.env.NEXT_UPLOAD_URL

export {
    muxTokenId,secretKey,uploadUrl
}