// models/Category.js
import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
	name: { type: String, required: true },
	type: { type: String, enum: ["income", "expense"], required: true },
	keywords: [String], // words/phrases that map to this category
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("Category", categorySchema);
