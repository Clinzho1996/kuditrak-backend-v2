import mongoose from "mongoose";

const budgetSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
	name: { type: String, required: true }, // e.g., "Groceries", "Entertainment"
	amount: { type: Number, required: true },
	spent: { type: Number, default: 0 },
	frequency: {
		type: String,
		enum: ["Daily", "Weekly", "Monthly"],
		default: "Monthly",
	},
	startDate: { type: Date, default: Date.now },
	endDate: { type: Date },
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("Budget", budgetSchema);
