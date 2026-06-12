import mongoose from "mongoose";
import SavingsBucket from "../models/SavingsBucket.js";
import Transaction from "../models/Transaction.js";
import Wallet from "../models/Wallet.js";
import { sendEmail } from "./emailService.js";
import { sendPush } from "./pushService.js";

export const processRecurringTopUps = async () => {
	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const buckets = await SavingsBucket.find({
			"topUpSchedule.frequency": { $exists: true },
		}).session(session);

		for (const bucket of buckets) {
			const wallet = await Wallet.findById(bucket.walletId).session(session);

			if (wallet.available < bucket.topUpSchedule.amount) continue;

			wallet.available -= bucket.topUpSchedule.amount;
			wallet.allocated += bucket.topUpSchedule.amount;
			bucket.currentAmount += bucket.topUpSchedule.amount;

			await wallet.save({ session });
			await bucket.save({ session });

			await Transaction.create(
				[
					{
						walletId: wallet._id,
						userId: bucket.userId,
						type: "SavingsAllocation",
						amount: bucket.topUpSchedule.amount,
						status: "Completed",
						metadata: { bucketId: bucket._id, reference: `TRX-${Date.now()}` },
					},
				],
				{ session },
			);

			// Push and email notifications
			const user = await mongoose.model("User").findById(bucket.userId);
			if (user.pushToken)
				await sendPush(
					user.pushToken,
					"Savings Top-Up",
					`Your bucket "${bucket.name}" has been funded automatically.`,
				);
			await sendEmail({
				to: user.email,
				subject: "Automatic Savings Top-Up",
				html: `<p>Your bucket "${bucket.name}" has been funded with ₦${bucket.topUpSchedule.amount}.</p>`,
			});
		}

		await session.commitTransaction();
		session.endSession();
	} catch (err) {
		await session.abortTransaction();
		session.endSession();
		console.error(err.message);
	}
};
