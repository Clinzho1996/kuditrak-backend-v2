// backend/models/CardRequest.js
import mongoose from "mongoose";

const cardRequestSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},

	// Step 1: Card Details
	cardDetails: {
		cardType: {
			type: String,
			enum: ["virtual", "physical"],
			required: true,
		},
		color: {
			type: String,
			enum: ["green", "blue", "purple", "orange", "pink", "teal"],
			default: "green",
		},
		cardName: {
			type: String,
			required: true,
			trim: true,
		},
		currency: {
			type: String,
			enum: ["USD", "NGN"],
			default: "USD",
		},
		budgetCategory: {
			type: String,
			enum: [
				"food",
				"transport",
				"entertain",
				"shopping",
				"utilities",
				"health",
				"education",
				"other",
			],
			default: "food",
		},
		spendingLimit: {
			type: Number,
			required: true,
			min: 0,
		},
	},

	// Step 2: Spending Limits & Notifications
	spendingControls: {
		totalLimit: {
			type: Number,
			required: true,
			min: 0,
		},
		alertThreshold: {
			type: Number,
			min: 0,
			max: 100,
			default: 75,
		},
		dailySpendingLimitEnabled: {
			type: Boolean,
			default: false,
		},
		dailyMaximum: {
			type: Number,
			default: 0,
		},
	},

	notifications: {
		transactionAlerts: {
			type: Boolean,
			default: true,
		},
		limitWarnings: {
			type: Boolean,
			default: true,
		},
		autoRefillAlerts: {
			type: Boolean,
			default: false,
		},
	},

	// Step 3: Review & Creation Status
	status: {
		type: String,
		enum: ["draft", "pending", "processing", "completed", "failed"],
		default: "draft",
	},

	// Provider specific IDs
	bridgecardCardId: {
		type: String,
		default: null,
	},
	anchorCustomerId: {
		type: String,
		default: null,
	},

	// Metadata
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

cardRequestSchema.index({ userId: 1, status: 1 });
cardRequestSchema.index({ createdAt: -1 });

export default mongoose.model("CardRequest", cardRequestSchema);
