// middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const protect = async (req, res, next) => {
	console.log("Protect middleware called");
	console.log("Arguments:", { hasReq: !!req, hasRes: !!res, hasNext: !!next });
	console.log("Next type:", typeof next);

	try {
		let token;
		if (
			req.headers.authorization &&
			req.headers.authorization.startsWith("Bearer")
		) {
			token = req.headers.authorization.split(" ")[1];
		}

		if (!token) {
			console.log("No token found");
			return res.status(401).json({ message: "Not authorized, token missing" });
		}

		console.log("Token found, verifying...");
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		console.log("Token decoded:", decoded);

		const user = await User.findById(decoded.id).select("-password");
		console.log("User found:", !!user);

		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		req.user = user;
		console.log("Calling next()");
		next();
	} catch (error) {
		console.log("Error in protect middleware:", error.message);
		res.status(401).json({ message: "Not authorized, token failed" });
	}
};

// backend/middleware/auth.js
export const adminOnly = async (req, res, next) => {
	try {
		if (!req.user) {
			return res.status(401).json({
				success: false,
				message: "Not authorized, please login",
				code: "UNAUTHORIZED",
			});
		}

		// Check if user has admin role
		if (!req.user.isAdmin) {
			return res.status(403).json({
				success: false,
				message: "Access denied. Admin privileges required.",
				code: "ADMIN_REQUIRED",
			});
		}

		next();
	} catch (error) {
		console.error("Admin middleware error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Server error",
			code: "SERVER_ERROR",
		});
	}
};

export default protect;
