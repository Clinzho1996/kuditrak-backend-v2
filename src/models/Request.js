// models/Request.js
import mongoose from "mongoose";

const requestSchema = new mongoose.Schema({
	senderId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},
	recipientId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},
	amount: {
		type: Number,
		required: true,
		min: 0,
	},
	note: {
		type: String,
		default: "",
	},
	status: {
		type: String,
		enum: ["pending", "approved", "declined", "expired"],
		default: "pending",
	},
	reference: {
		type: String,
		unique: true,
		required: true,
	},
	respondedAt: {
		type: Date,
		default: null,
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
	updatedAt: {
		type: Date,
		default: Date.now,
	},
});

export default mongoose.model("Request", requestSchema);
