// backend/models/BridgecardCardholder.js
import mongoose from "mongoose";

const bridgecardCardholderSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		unique: true,
		index: true,
	},
	cardholderId: {
		type: String,
		required: true,
		unique: true,
		index: true,
	},
	isActive: {
		type: Boolean,
		default: false,
	},
	isIdVerified: {
		type: Boolean,
		default: false,
	},
	bridgecardData: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},
	metaData: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model(
	"BridgecardCardholder",
	bridgecardCardholderSchema,
);
