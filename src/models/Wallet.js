import mongoose from "mongoose";

const walletSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		unique: true, // ensure one wallet per user
	},
	balance: {
		type: Number,
		default: 0,
		min: 0, // prevent negative total balance
	},
	allocated: {
		type: Number,
		default: 0,
		min: 0, // prevent negative allocated balance
	},
	available: {
		type: Number,
		default: 0,
		min: 0, // prevent negative available balance
	},
	currency: {
		type: String,
		default: "NGN",
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

export default mongoose.model("Wallet", walletSchema);
