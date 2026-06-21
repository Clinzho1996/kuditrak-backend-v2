// models/GroupSavings.js
import mongoose from "mongoose";

const groupSavingsSchema = new mongoose.Schema({
	name: {
		type: String,
		required: true,
	},
	description: {
		type: String,
		default: "",
	},
	groupCode: {
		type: String,
		required: true,
		unique: true,
	},
	createdBy: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
	},
	frequency: {
		type: String,
		enum: ["daily", "weekly", "bi-weekly", "monthly"],
		default: "weekly",
	},
	contributionAmount: {
		type: Number,
		required: true,
		min: 0,
	},
	maxMembers: {
		type: Number,
		default: 10,
	},
	memberCount: {
		type: Number,
		default: 1,
	},
	totalContributions: {
		type: Number,
		default: 0,
	},
	currentCycle: {
		type: Number,
		default: 1,
	},
	payoutOrder: {
		type: String,
		enum: ["sequential", "random", "fixed"],
		default: "sequential",
	},
	payoutSchedule: {
		type: [mongoose.Schema.Types.ObjectId],
		ref: "User",
		default: [],
	},
	subAccountId: {
		type: String,
		default: null,
	},
	isPrivate: {
		type: Boolean,
		default: false,
	},
	inviteOnly: {
		type: Boolean,
		default: false,
	},
	status: {
		type: String,
		enum: ["active", "paused", "completed", "cancelled"],
		default: "active",
	},
	icon: {
		type: String,
		default: "👥",
	},
	color: {
		type: String,
		default: "#4F46E5",
	},
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
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

export default mongoose.model("GroupSavings", groupSavingsSchema);
