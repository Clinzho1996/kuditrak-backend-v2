import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const connectDB = async () => {
	await mongoose.connect(process.env.MONGO_URI);
	console.log("MongoDB Connected");
};

export default connectDB;
