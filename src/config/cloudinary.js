import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

export default cloudinary;

export const getUploadSignature = async (req, res) => {
	const signature = cloudinary.utils.api_sign_request(
		{ timestamp: Date.now() },
		process.env.CLOUD_SECRET,
	);

	res.json({ signature });
};
