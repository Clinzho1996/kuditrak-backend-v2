// backend/models/TransactionPin.js - Fixed (no pre-save hook)

import mongoose from "mongoose";

const transactionPinSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		unique: true,
		index: true,
	},
	pinHash: {
		type: String,
		required: true,
	},
	pinSalt: {
		type: String,
		required: true,
	},
	hasSetPin: {
		type: Boolean,
		default: false,
	},
	failedAttempts: {
		type: Number,
		default: 0,
	},
	lastFailedAttempt: {
		type: Date,
		default: null,
	},
	isLocked: {
		type: Boolean,
		default: false,
	},
	lockedUntil: {
		type: Date,
		default: null,
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

// Method to verify PIN
transactionPinSchema.methods.verifyPin = async function (pin) {
	if (this.isLocked && this.lockedUntil && new Date() < this.lockedUntil) {
		throw new Error(`PIN is locked until ${this.lockedUntil}`);
	}

	const isValid = await bcrypt.compare(pin, this.pinHash);

	if (!isValid) {
		this.failedAttempts += 1;
		this.lastFailedAttempt = new Date();

		if (this.failedAttempts >= 5) {
			this.isLocked = true;
			this.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
		}

		await this.save();
		throw new Error(
			`Invalid PIN. ${5 - this.failedAttempts} attempts remaining.`,
		);
	}

	this.failedAttempts = 0;
	this.lastFailedAttempt = null;
	this.isLocked = false;
	this.lockedUntil = null;
	await this.save();

	return true;
};

export default mongoose.model("TransactionPin", transactionPinSchema);
