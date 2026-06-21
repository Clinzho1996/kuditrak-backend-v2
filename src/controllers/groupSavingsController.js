// controllers/groupSavingsController.js
import AnchorSubAccount from "../models/AnchorSubAccount.js";
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorWallet from "../models/AnchorWallet.js";
import GroupContribution from "../models/GroupContribution.js";
import GroupMember from "../models/GroupMember.js";
import GroupPayout from "../models/GroupPayout.js";
import GroupSavings from "../models/GroupSavings.js";
import { sendPushToUser } from "../services/pushService.js";

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate a unique group code
 */
const generateGroupCode = () => {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let code = "";
	for (let i = 0; i < 8; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
};

const getOrCreateGroupSubAccount = async (userId, group) => {
	let subAccount = await AnchorSubAccount.findOne({
		userId,
		subAccountId: group.subAccountId || `group_${group._id}`,
	});

	if (!subAccount) {
		// Get main wallet as parent
		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			throw new Error("Wallet not found");
		}

		// ✅ Create ONLY AnchorSubAccount, NOT UserGoal
		subAccount = await AnchorSubAccount.create({
			userId,
			parentWalletId: wallet._id,
			subAccountId: `group_${group._id}_${Date.now().toString().slice(-6)}`,
			name: group.name,
			type: "savings",
			balance: 0,
			targetAmount: null,
			autoSave: {
				enabled: false,
				amount: 0,
				frequency: "monthly",
				dayOfMonth: 1,
			},
			lockSettings: {
				enabled: false,
				unlockDate: null,
				lockedAt: null,
			},
			icon: group.icon || "👥",
			color: group.color || "#4F46E5",
			metadata: {
				groupId: group._id,
				type: "group_savings",
				memberCount: group.memberCount || 0,
			},
		});

		group.subAccountId = subAccount.subAccountId;
		await group.save();
	}

	return subAccount;
};
/**
 * Process payout for a group
 */
const processPayout = async (groupId) => {
	try {
		const group = await GroupSavings.findById(groupId);
		if (!group) return;

		let payoutMemberId = null;

		if (group.payoutOrder === "sequential") {
			const paidMembers = await GroupPayout.find({
				groupId: group._id,
				cycle: group.currentCycle,
			});

			const members = await GroupMember.find({
				groupId: group._id,
				status: "active",
			}).sort({ joinedAt: 1 });

			const paidIds = paidMembers.map((p) => p.memberId.toString());
			for (const member of members) {
				if (!paidIds.includes(member.userId.toString())) {
					payoutMemberId = member.userId;
					break;
				}
			}
		} else if (group.payoutOrder === "random") {
			const members = await GroupMember.find({
				groupId: group._id,
				status: "active",
			});
			const randomIndex = Math.floor(Math.random() * members.length);
			payoutMemberId = members[randomIndex].userId;
		} else if (
			group.payoutOrder === "fixed" &&
			group.payoutSchedule?.length > 0
		) {
			const currentIndex =
				(group.currentCycle - 1) % group.payoutSchedule.length;
			payoutMemberId = group.payoutSchedule[currentIndex];
		}

		if (!payoutMemberId) {
			console.log("No eligible member for payout this cycle");
			return;
		}

		const subAccount = await AnchorSubAccount.findOne({
			userId: group.createdBy,
			subAccountId: group.subAccountId,
		});

		if (!subAccount || subAccount.balance === 0) {
			console.log("No funds in group account");
			return;
		}

		const payoutAmount = group.contributionAmount * group.memberCount;

		if (subAccount.balance < payoutAmount) {
			console.log(
				`Insufficient funds: ${subAccount.balance} < ${payoutAmount}`,
			);
			return;
		}

		const recipientWallet = await AnchorWallet.findOne({
			userId: payoutMemberId,
			walletType: "main",
		});

		if (!recipientWallet) {
			console.log("Recipient wallet not found");
			return;
		}

		subAccount.balance -= payoutAmount;
		await subAccount.save();

		recipientWallet.balance += payoutAmount;
		recipientWallet.available =
			recipientWallet.balance - (recipientWallet.allocated || 0);
		await recipientWallet.save();

		const payout = new GroupPayout({
			groupId: group._id,
			cycle: group.currentCycle,
			memberId: payoutMemberId,
			amount: payoutAmount,
			status: "completed",
			paidAt: new Date(),
			transactionId: `payout_${Date.now()}`,
		});

		await payout.save();

		const senderWallet = await AnchorWallet.findOne({
			userId: group.createdBy,
			walletType: "main",
		});

		if (senderWallet) {
			await AnchorTransaction.create({
				userId: payoutMemberId,
				anchorCustomerId: recipientWallet.anchorCustomerId,
				walletId: recipientWallet._id,
				amount: payoutAmount,
				currency: "NGN",
				type: "credit",
				category: "group_payout",
				status: "success",
				description: `Payout from group: ${group.name} (Cycle ${group.currentCycle})`,
				source: "sub_account",
				destination: "wallet",
				metadata: {
					groupId: group._id,
					groupName: group.name,
					cycle: group.currentCycle,
					payoutId: payout._id,
					isGroupPayout: true,
				},
			});
		}

		await GroupMember.updateMany(
			{ groupId: group._id },
			{
				$set: {
					"cycleStatus.paid": false,
					"cycleStatus.paidAt": null,
					"cycleStatus.amountPaid": 0,
				},
				$inc: { "cycleStatus.cycle": 1 },
			},
		);

		group.currentCycle += 1;
		await group.save();

		await sendPushToUser(
			payoutMemberId,
			"🎉 You Received a Payout!",
			`₦${payoutAmount.toLocaleString()} paid out from "${group.name}" (Cycle ${group.currentCycle - 1})`,
			{
				type: "group_payout",
				groupId: group._id,
				amount: payoutAmount,
				cycle: group.currentCycle - 1,
			},
		);

		console.log(
			`✅ Payout completed: ₦${payoutAmount} to user ${payoutMemberId}`,
		);
	} catch (err) {
		console.error("Process payout error:", err);
	}
};

// ==================== GROUP MANAGEMENT ====================

// controllers/groupSavingsController.js - Fix createGroup

export const createGroup = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			name,
			description,
			frequency = "weekly",
			contributionAmount,
			maxMembers = 10,
			payoutOrder = "sequential",
			payoutSchedule,
			isPrivate = false,
			inviteOnly = false,
			icon = "👥",
			color = "#4F46E5",
		} = req.body;

		console.log("📤 Creating group:", { name, contributionAmount, userId });

		// Validate
		if (!name || !contributionAmount || contributionAmount <= 0) {
			return res.status(400).json({
				error: "Group name and contribution amount are required",
			});
		}

		// Check if user already has a group with same name
		const existing = await GroupSavings.findOne({
			createdBy: userId,
			name: { $regex: new RegExp(`^${name}$`, "i") },
			status: "active",
		});

		if (existing) {
			return res.status(400).json({
				error: "You already have a group with this name",
			});
		}

		// Check if user has a wallet
		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({
				error: "Wallet not found. Please create a wallet first.",
			});
		}

		console.log("✅ Wallet found:", wallet._id);

		// Generate unique group code
		let groupCode = generateGroupCode();
		let exists = await GroupSavings.findOne({ groupCode });
		while (exists) {
			groupCode = generateGroupCode();
			exists = await GroupSavings.findOne({ groupCode });
		}

		// Create group
		const group = new GroupSavings({
			name,
			description,
			groupCode,
			createdBy: userId,
			frequency,
			contributionAmount,
			maxMembers,
			payoutOrder,
			payoutSchedule: payoutOrder === "fixed" ? payoutSchedule : [],
			isPrivate,
			inviteOnly,
			icon,
			color,
			status: "active",
			currentCycle: 1,
			totalContributions: 0,
			memberCount: 1,
		});

		await group.save();
		console.log("✅ Group saved:", group._id);

		// Create group sub-account
		let subAccount;
		try {
			subAccount = await getOrCreateGroupSubAccount(userId, group);
			console.log("✅ Sub-account created:", subAccount.subAccountId);
		} catch (subError) {
			console.error("❌ Sub-account error:", subError);
		}

		// ✅ Add creator as first member with status "active"
		const member = new GroupMember({
			groupId: group._id,
			userId: userId,
			role: "admin",
			status: "active", // ✅ Ensure this is "active", not "pending"
			joinedAt: new Date(),
			totalContributed: 0,
			cycleStatus: {
				cycle: 1,
				paid: false,
				amountDue: contributionAmount,
				paidAt: null,
				amountPaid: 0,
			},
		});

		await member.save();
		console.log("✅ Member added with status:", member.status);

		// Send notification
		await sendPushToUser(
			userId,
			"👥 Group Savings Created!",
			`You've created "${name}". Share the code ${groupCode} with friends to join.`,
			{
				type: "group_created",
				groupId: group._id,
				groupCode,
			},
		);

		// ✅ Return complete data
		const groupData = {
			...group.toObject(),
			role: member.role,
			status: member.status,
			joinedAt: member.joinedAt,
			totalContributed: member.totalContributed,
			cycleStatus: member.cycleStatus,
		};

		res.status(201).json({
			success: true,
			message: "Group created successfully",
			data: {
				group: groupData,
				member,
				subAccount: subAccount
					? {
							balance: subAccount.balance,
							subAccountId: subAccount.subAccountId,
						}
					: null,
				groupCode,
			},
		});
	} catch (err) {
		console.error("❌ Create group error:", err);
		res.status(500).json({
			error: err.message,
			details: err.stack,
		});
	}
};

export const getGroupDetails = async (req, res) => {
	try {
		const { groupId } = req.params;
		const userId = req.user._id;

		const group = await GroupSavings.findOne({
			_id: groupId,
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const member = await GroupMember.findOne({
			groupId: group._id,
			userId,
			status: "active",
		});

		if (!member) {
			return res
				.status(403)
				.json({ error: "You are not a member of this group" });
		}

		const members = await GroupMember.find({
			groupId: group._id,
			status: "active",
		}).populate("userId", "fullName email profileImage");

		const contributions = await GroupContribution.find({
			groupId: group._id,
		})
			.sort({ createdAt: -1 })
			.limit(20);

		const subAccount = await AnchorSubAccount.findOne({
			userId: group.createdBy,
			subAccountId: group.subAccountId,
		});

		res.status(200).json({
			success: true,
			data: {
				group,
				members,
				contributions,
				balance: subAccount?.balance || 0,
				isAdmin: group.createdBy.toString() === userId.toString(),
				memberStatus: member,
				totalMembers: members.length,
			},
		});
	} catch (err) {
		console.error("Get group details error:", err);
		res.status(500).json({ error: err.message });
	}
};

// controllers/groupSavingsController.js - Fix getUserGroups

export const getUserGroups = async (req, res) => {
	try {
		const userId = req.user._id;

		console.log("🔍 Fetching groups for user:", userId);

		// ✅ Find all group memberships for the user
		const groupMemberships = await GroupMember.find({
			userId,
			status: "active",
		}).lean();

		console.log(`📊 Found ${groupMemberships.length} memberships`);

		if (groupMemberships.length === 0) {
			return res.status(200).json({
				success: true,
				data: [],
			});
		}

		// ✅ Extract group IDs safely
		const groupIds = groupMemberships
			.map((gm) => gm.groupId)
			.filter((id) => id); // Remove any null/undefined

		console.log(`📊 Group IDs:`, groupIds);

		if (groupIds.length === 0) {
			return res.status(200).json({
				success: true,
				data: [],
			});
		}

		// ✅ Get the actual group data for each membership
		const groups = await GroupSavings.find({
			_id: { $in: groupIds },
			status: "active",
		}).lean();

		console.log(`📊 Found ${groups.length} active groups`);

		// ✅ Add membership info to each group safely
		const groupsWithMembership = groups.map((group) => {
			// Find the matching membership
			const membership = groupMemberships.find(
				(gm) => gm.groupId && gm.groupId.toString() === group._id.toString(),
			);

			return {
				...group,
				role: membership?.role || "member",
				joinedAt: membership?.joinedAt || null,
				totalContributed: membership?.totalContributed || 0,
				cycleStatus: membership?.cycleStatus || {
					cycle: group.currentCycle || 1,
					paid: false,
					amountDue: group.contributionAmount || 0,
				},
			};
		});

		console.log(`✅ Returning ${groupsWithMembership.length} groups for user`);

		res.status(200).json({
			success: true,
			data: groupsWithMembership,
		});
	} catch (err) {
		console.error("❌ Get user groups error:", err);
		res.status(500).json({
			success: false,
			error: err.message,
			message: "Failed to fetch user groups",
		});
	}
};

export const updateGroup = async (req, res) => {
	try {
		const { groupId } = req.params;
		const {
			name,
			description,
			maxMembers,
			payoutOrder,
			payoutSchedule,
			icon,
			color,
		} = req.body;

		const group = await GroupSavings.findOne({
			_id: groupId,
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const member = await GroupMember.findOne({
			groupId: group._id,
			userId: req.user._id,
			role: "admin",
			status: "active",
		});

		if (!member) {
			return res
				.status(403)
				.json({ error: "Only admins can update the group" });
		}

		if (name) group.name = name;
		if (description !== undefined) group.description = description;
		if (maxMembers) group.maxMembers = maxMembers;
		if (payoutOrder) group.payoutOrder = payoutOrder;
		if (payoutSchedule) group.payoutSchedule = payoutSchedule;
		if (icon) group.icon = icon;
		if (color) group.color = color;

		group.updatedAt = new Date();
		await group.save();

		res.status(200).json({
			success: true,
			message: "Group updated successfully",
			data: group,
		});
	} catch (err) {
		console.error("Update group error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ==================== MEMBERSHIP ====================

export const joinGroup = async (req, res) => {
	try {
		const userId = req.user._id;
		const { groupCode } = req.body;

		if (!groupCode) {
			return res.status(400).json({ error: "Group code is required" });
		}

		const group = await GroupSavings.findOne({
			groupCode: groupCode.toUpperCase(),
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const existingMember = await GroupMember.findOne({
			groupId: group._id,
			userId,
			status: { $ne: "inactive" },
		});

		if (existingMember) {
			return res.status(400).json({
				error: "You are already a member of this group",
			});
		}

		const memberCount = await GroupMember.countDocuments({
			groupId: group._id,
			status: "active",
		});

		if (memberCount >= group.maxMembers) {
			return res.status(400).json({
				error: `Group is full (max ${group.maxMembers} members)`,
			});
		}

		const member = new GroupMember({
			groupId: group._id,
			userId,
			role: "member",
			status: "active",
			joinedAt: new Date(),
			totalContributed: 0,
			cycleStatus: {
				cycle: group.currentCycle,
				paid: false,
				amountDue: group.contributionAmount,
			},
		});

		await member.save();

		group.memberCount = memberCount + 1;
		await group.save();

		await sendPushToUser(
			userId,
			"🎉 Joined Group!",
			`You've joined "${group.name}". Start contributing to grow together!`,
			{
				type: "group_joined",
				groupId: group._id,
				groupName: group.name,
			},
		);

		await sendPushToUser(
			group.createdBy,
			"👤 New Member Joined",
			`${req.user.fullName} joined your group "${group.name}"`,
			{
				type: "group_member_joined",
				groupId: group._id,
				memberId: userId,
				memberName: req.user.fullName,
			},
		);

		res.status(200).json({
			success: true,
			message: "Joined group successfully",
			data: {
				group,
				member,
			},
		});
	} catch (err) {
		console.error("Join group error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const leaveGroup = async (req, res) => {
	try {
		const userId = req.user._id;
		const { groupId } = req.params;

		const group = await GroupSavings.findOne({
			_id: groupId,
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const member = await GroupMember.findOne({
			groupId: group._id,
			userId,
			status: "active",
		});

		if (!member) {
			return res
				.status(403)
				.json({ error: "You are not a member of this group" });
		}

		const adminCount = await GroupMember.countDocuments({
			groupId: group._id,
			role: "admin",
			status: "active",
		});

		if (member.role === "admin" && adminCount === 1) {
			return res.status(400).json({
				error: "You are the only admin. Assign another admin before leaving.",
			});
		}

		if (member.cycleStatus?.paid) {
			return res.status(400).json({
				error:
					"You have already contributed this cycle. Wait for payout or request refund.",
			});
		}

		member.status = "inactive";
		member.leftAt = new Date();
		await member.save();

		const memberCount = await GroupMember.countDocuments({
			groupId: group._id,
			status: "active",
		});
		group.memberCount = memberCount;
		await group.save();

		await sendPushToUser(
			userId,
			"👋 Left Group",
			`You have left "${group.name}"`,
			{
				type: "group_left",
				groupId: group._id,
			},
		);

		res.status(200).json({
			success: true,
			message: "Left group successfully",
		});
	} catch (err) {
		console.error("Leave group error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const getGroupMembers = async (req, res) => {
	try {
		const { groupId } = req.params;
		const userId = req.user._id;

		const group = await GroupSavings.findOne({
			_id: groupId,
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const member = await GroupMember.findOne({
			groupId: group._id,
			userId,
			status: "active",
		});

		if (!member) {
			return res
				.status(403)
				.json({ error: "You are not a member of this group" });
		}

		const members = await GroupMember.find({
			groupId: group._id,
			status: "active",
		}).populate("userId", "fullName email profileImage");

		res.status(200).json({
			success: true,
			data: members,
		});
	} catch (err) {
		console.error("Get group members error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const removeMember = async (req, res) => {
	try {
		const { groupId, memberId } = req.params;

		const group = await GroupSavings.findOne({
			_id: groupId,
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const admin = await GroupMember.findOne({
			groupId: group._id,
			userId: req.user._id,
			role: "admin",
			status: "active",
		});

		if (!admin) {
			return res.status(403).json({ error: "Only admins can remove members" });
		}

		if (req.user._id.toString() === memberId) {
			return res.status(400).json({ error: "Cannot remove yourself" });
		}

		const memberToRemove = await GroupMember.findOne({
			groupId: group._id,
			userId: memberId,
			status: "active",
		});

		if (!memberToRemove) {
			return res.status(404).json({ error: "Member not found" });
		}

		if (memberToRemove.role === "admin") {
			const adminCount = await GroupMember.countDocuments({
				groupId: group._id,
				role: "admin",
				status: "active",
			});

			if (adminCount <= 1) {
				return res.status(400).json({
					error: "Cannot remove the only admin. Assign another admin first.",
				});
			}
		}

		memberToRemove.status = "inactive";
		memberToRemove.leftAt = new Date();
		await memberToRemove.save();

		const memberCount = await GroupMember.countDocuments({
			groupId: group._id,
			status: "active",
		});
		group.memberCount = memberCount;
		await group.save();

		await sendPushToUser(
			memberId,
			"👥 Removed from Group",
			`You have been removed from "${group.name}"`,
			{
				type: "group_member_removed",
				groupId: group._id,
				groupName: group.name,
			},
		);

		res.status(200).json({
			success: true,
			message: "Member removed successfully",
		});
	} catch (err) {
		console.error("Remove member error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ==================== CONTRIBUTIONS ====================

export const contributeToGroup = async (req, res) => {
	try {
		const userId = req.user._id;
		const { groupId, amount } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Valid amount required" });
		}

		const group = await GroupSavings.findOne({
			_id: groupId,
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const member = await GroupMember.findOne({
			groupId: group._id,
			userId,
			status: "active",
		});

		if (!member) {
			return res
				.status(403)
				.json({ error: "You are not a member of this group" });
		}

		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({ error: "Wallet not found" });
		}

		if (wallet.balance < amount) {
			return res.status(400).json({
				error: "Insufficient balance",
				available: wallet.balance,
				requested: amount,
			});
		}

		const subAccount = await getOrCreateGroupSubAccount(userId, group);

		wallet.balance -= amount;
		subAccount.balance += amount;
		wallet.available = wallet.balance - (wallet.allocated || 0);
		await wallet.save();
		await subAccount.save();

		member.totalContributed += amount;
		member.cycleStatus = {
			cycle: group.currentCycle,
			paid: true,
			amountDue: group.contributionAmount,
			paidAt: new Date(),
			amountPaid: amount,
		};
		await member.save();

		const contribution = new GroupContribution({
			groupId: group._id,
			memberId: userId,
			amount,
			cycle: group.currentCycle,
			status: "completed",
			paymentMethod: "wallet",
			transactionId: `contrib_${Date.now()}`,
			metadata: {
				walletBalance: wallet.balance,
				subAccountBalance: subAccount.balance,
			},
		});

		await contribution.save();

		group.totalContributions += amount;
		await group.save();

		await AnchorTransaction.create({
			userId,
			anchorCustomerId: wallet.anchorCustomerId,
			walletId: wallet._id,
			subAccountId: subAccount._id,
			amount,
			currency: "NGN",
			type: "debit",
			category: "transfer",
			status: "success",
			description: `Contribution to group: ${group.name}`,
			source: "wallet",
			destination: "sub_account",
			metadata: {
				groupId: group._id,
				groupName: group.name,
				contributionId: contribution._id,
				isGroupContribution: true,
			},
		});

		const members = await GroupMember.find({
			groupId: group._id,
			status: "active",
		});

		const allPaid = members.every((m) => m.cycleStatus?.paid === true);

		if (allPaid) {
			await processPayout(group._id);
		}

		await sendPushToUser(
			userId,
			"💰 Contribution Successful!",
			`₦${amount.toLocaleString()} contributed to "${group.name}"`,
			{
				type: "group_contribution",
				groupId: group._id,
				amount,
				cycle: group.currentCycle,
			},
		);

		res.status(200).json({
			success: true,
			message: "Contribution successful",
			data: {
				contribution,
				member,
				group,
				walletBalance: wallet.balance,
				groupBalance: subAccount.balance,
			},
		});
	} catch (err) {
		console.error("Contribute to group error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const getGroupContributions = async (req, res) => {
	try {
		const { groupId } = req.params;
		const { limit = 50, offset = 0 } = req.query;

		const group = await GroupSavings.findOne({
			_id: groupId,
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const contributions = await GroupContribution.find({
			groupId: group._id,
		})
			.sort({ createdAt: -1 })
			.skip(parseInt(offset))
			.limit(parseInt(limit))
			.populate("memberId", "fullName email profileImage");

		const total = await GroupContribution.countDocuments({
			groupId: group._id,
		});

		res.status(200).json({
			success: true,
			data: contributions,
			pagination: {
				limit: parseInt(limit),
				offset: parseInt(offset),
				total,
				hasMore: offset + limit < total,
			},
		});
	} catch (err) {
		console.error("Get group contributions error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ==================== PAYOUTS ====================

export const getGroupPayouts = async (req, res) => {
	try {
		const { groupId } = req.params;
		const { limit = 50, offset = 0 } = req.query;

		const group = await GroupSavings.findOne({
			_id: groupId,
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const payouts = await GroupPayout.find({
			groupId: group._id,
		})
			.sort({ createdAt: -1 })
			.skip(parseInt(offset))
			.limit(parseInt(limit))
			.populate("memberId", "fullName email profileImage");

		const total = await GroupPayout.countDocuments({
			groupId: group._id,
		});

		res.status(200).json({
			success: true,
			data: payouts,
			pagination: {
				limit: parseInt(limit),
				offset: parseInt(offset),
				total,
				hasMore: offset + limit < total,
			},
		});
	} catch (err) {
		console.error("Get group payouts error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const processPayoutManually = async (req, res) => {
	try {
		const { groupId } = req.params;

		const group = await GroupSavings.findOne({
			_id: groupId,
			status: "active",
		});

		if (!group) {
			return res.status(404).json({ error: "Group not found" });
		}

		const admin = await GroupMember.findOne({
			groupId: group._id,
			userId: req.user._id,
			role: "admin",
			status: "active",
		});

		if (!admin) {
			return res.status(403).json({ error: "Only admins can process payouts" });
		}

		await processPayout(groupId);

		res.status(200).json({
			success: true,
			message: "Payout processed successfully",
		});
	} catch (err) {
		console.error("Process payout manually error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ==================== EXPORT ====================

export default {
	// Group Management
	createGroup,
	getGroupDetails,
	getUserGroups,
	updateGroup,

	// Membership
	joinGroup,
	leaveGroup,
	getGroupMembers,
	removeMember,

	// Contributions
	contributeToGroup,
	getGroupContributions,

	// Payouts
	getGroupPayouts,
	processPayoutManually,
};
