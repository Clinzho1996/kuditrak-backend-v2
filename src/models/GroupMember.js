// models/GroupMember.js
import mongoose from "mongoose";

const groupMemberSchema = new mongoose.Schema({
	groupId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "GroupSavings",
		required: true,
	},
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
	},
	role: {
		type: String,
		enum: ["admin", "member"],
		default: "member",
	},
	status: {
		type: String,
		enum: ["active", "inactive", "suspended"],
		default: "active",
	},
	joinedAt: {
		type: Date,
		default: Date.now,
	},
	leftAt: {
		type: Date,
		default: null,
	},
	totalContributed: {
		type: Number,
		default: 0,
	},
	cycleStatus: {
		cycle: { type: Number, default: 1 },
		paid: { type: Boolean, default: false },
		amountDue: { type: Number, default: 0 },
		paidAt: { type: Date, default: null },
		amountPaid: { type: Number, default: 0 },
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

groupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });

export default mongoose.model("GroupMember", groupMemberSchema);
