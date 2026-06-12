import { calculateUserInsights } from "../services/analyticsService.js";

export const getUserInsights = async (req, res) => {
	try {
		const insights = await calculateUserInsights(req.user._id);
		res.json(insights);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};
