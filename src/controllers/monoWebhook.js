import BankConnection from "../models/BankConnection.js";
import User from "../models/User.js";

export const handleMonoWebhook = async (req, res) => {
	try {
		const { data } = req.body;
		const accountData = data.data.account;
		const customerData = data.data.customer || { id: req.body.customerId };

		// Find the user by monoCustomerId
		const user = await User.findOne({ monoCustomerId: customerData.id });
		if (!user) {
			return res
				.status(404)
				.json({ success: false, message: "User not found" });
		}

		// Upsert the bank connection
		const connection = await BankConnection.findOneAndUpdate(
			{ userId: user._id, monoAccountId: accountData._id },
			{
				userId: user._id,
				accountName: accountData.name,
				accountNumber: accountData.accountNumber,
				bankName: accountData.institution.name,
				monoAccountId: accountData._id,
				provider: "mono",
				status: "Active",
				lastSync: new Date(),
			},
			{ upsert: true, new: true }, // new: true returns the updated/created doc
		);

		// Now return the connection in the response
		res
			.status(200)
			.json({
				success: true,
				message: "Account linked successfully",
				connection,
			});
	} catch (err) {
		console.error("Webhook error:", err);
		res.status(500).json({ success: false, error: err.message });
	}
};
