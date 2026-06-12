// backend/models/Notification.js
import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},
	title: {
		type: String,
		required: true,
		trim: true,
	},
	body: {
		type: String,
		required: true,
	},
	type: {
		type: String,
		enum: [
			"system",
			"budget_alert",
			"savings_goal",
			"subscription",
			"transaction",
			"investment",
			"general",
		],
		default: "general",
	},
	data: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},
	is_read: {
		type: Boolean,
		default: false,
	},
	is_push_sent: {
		type: Boolean,
		default: false,
	},
	push_token: {
		type: String,
		default: null,
	},
	created_at: {
		type: Date,
		default: Date.now,
	},
	read_at: {
		type: Date,
		default: null,
	},
});

// Index for faster queries
notificationSchema.index({ userId: 1, created_at: -1 });
notificationSchema.index({ userId: 1, is_read: 1 });

export default mongoose.model("Notification", notificationSchema);
