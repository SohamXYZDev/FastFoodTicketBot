# 🍕 FastFood Ticket Bot

A comprehensive Discord bot for managing food delivery orders with chef status tracking, debt management, and automated ticket assignment.

## ✨ Features

### 🎫 **Advanced Ticket System**

- **Button-based ticket creation** for DoorDash and UberEats orders
- **Automatic chef assignment** based on availability
- **High demand alerts** when 2+ tickets are active
- **Auto-hiding tickets** when chefs go offline
- **Channel management** with proper permissions

### 👨‍🍳 **Chef Management**

- **Real-time status dashboard** (OPEN/BUSY/CLOSED)
- **Automatic status updates** based on workload
- **Chef availability tracking**
- **Live embed updates** for status changes

### 💰 **Debt & Payment Tracking**

- **Automatic debt calculation** per order completion
- **Individual and global debt tracking**
- **Order history logging**
- **Payment amount configuration** by platform
- **Admin debt management** (view/clear)

### 🔧 **Admin Tools**

- **Comprehensive command set** for management
- **Order history viewing** for all chefs
- **Active ticket monitoring**
- **Database management**
- **Configuration flexibility**

## 🚀 Setup Instructions

### 1. Prerequisites

- Node.js v16 or higher
- MongoDB database (local or cloud like MongoDB Atlas)
- Discord Bot Token and Application
- Discord Server with proper permissions

### 2. Installation

1. **Clone/Download** this repository
2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Configure environment** - Copy `.env` and fill in your values:

   ```env
   # Discord Bot Configuration
   DISCORD_TOKEN=your_bot_token_here
   CLIENT_ID=your_client_id_here
   GUILD_ID=your_guild_id_here

   # Database Configuration
   MONGODB_URI=mongodb://localhost:27017/fastfood-ticket-bot

   # Channel Configuration
   STATUS_CHANNEL_ID=your_status_channel_id_here
   TICKET_CATEGORY_ID=your_ticket_category_id_here

   # Role Configuration
   CHEF_ROLE_ID=your_chef_role_id_here
   ADMIN_ROLE_ID=your_admin_role_id_here

   # Pricing Configuration
   DOORDASH_AMOUNT=5.00
   UBEREATS_AMOUNT=4.50
   ```

4. **Deploy commands** to your server:

   ```bash
   npm run deploy
   ```

5. **Start the bot**:
   ```bash
   npm start
   ```

### 3. Discord Server Setup

1. **Create Channels**:

   - `#chef-status` - For the live chef status dashboard
   - `#create-ticket` - For ticket creation buttons
   - **Tickets Category** - Where individual ticket channels will be created

2. **Create Roles**:

   - `@Chef` - For delivery chefs
   - `@Admin` - For bot administrators

3. **Set Permissions**:
   - Bot needs `Manage Channels`, `Manage Messages`, `Embed Links`
   - Chefs need access to their role commands
   - Admins need access to management commands

## 📋 Commands Reference

### 👥 **Customer Commands**

- `/help` - Show help message
- `/close [reason]` - Close your ticket

### 👨‍🍳 **Chef Commands**

- `/chef [user] <status>` - Set chef status (OPEN/BUSY/CLOSED)
- `/complete <ordertype>` - Complete order and add debt
- `/debt check [chef]` - Check debt information
- `/history` - View order history

### 👑 **Admin Commands**

- `/setup-tickets` - Send ticket creation embed
- `/setup-status` - Update chef status embed
- `/debt all` - View all chef debts
- `/debt clear <chef>` - Clear chef debt
- `/tickets` - View active tickets
- `/history [chef]` - View any chef's history

## 🎯 Workflow

### **For Customers:**

1. Click DoorDash or UberEats button in ticket channel
2. Get automatically assigned to available chef
3. Receive private ticket channel
4. Communicate with chef about order
5. Order gets completed by chef

### **For Chefs:**

1. Set status with `/chef` command
2. Get assigned to customer tickets automatically
3. Help customers with their orders
4. Use `/complete` when order is done
5. Track debt with `/debt check`

### **For Admins:**

1. Set up ticket and status embeds
2. Monitor active tickets
3. Check chef debts and performance
4. Manage chef statuses if needed
5. Clear debts when chefs pay

## 🏗️ Project Structure

```
FastFoodTicketBot/
├── commands/
│   ├── admin/          # Admin-only commands
│   │   ├── debt.js
│   │   ├── help.js
│   │   ├── history.js
│   │   ├── setup-status.js
│   │   └── tickets.js
│   ├── chef/           # Chef commands
│   │   ├── chef.js
│   │   └── complete.js
│   └── ticket/         # Ticket management
│       ├── close.js
│       └── setup-tickets.js
├── database.js         # SQLite database handler
├── deploy-commands.js  # Command deployment
├── index.js           # Main bot file
├── package.json       # Dependencies and scripts
└── .env              # Environment configuration
```

## 💾 Database Schema

The bot uses MongoDB with Mongoose for data persistence. Two main collections:

### **chefs collection**

- `user_id` - Discord user ID (String, unique)
- `username` - Discord username (String)
- `status` - Current chef status (Enum: OPEN/BUSY/CLOSED)
- `debt_amount` - Total debt owed (Number, default: 0)
- `total_completed` - Number of completed orders (Number, default: 0)
- `created_at` - Account creation timestamp (Date)

### **orders collection**

- `chef_id` - Chef who completed the order (String)
- `customer_id` - Customer who placed the order (String)
- `order_type` - Platform (Enum: doordash/ubereats)
- `amount` - Order payment amount (Number)
- `completed_at` - Completion timestamp (Date)

## 🔧 Configuration Options

### **Pricing**

Adjust `DOORDASH_AMOUNT` and `UBEREATS_AMOUNT` in `.env`

### **High Demand Threshold**

Modify `checkHighDemand()` function in `index.js` (currently set to 2 tickets)

### **Auto-assignment Logic**

Update `getAvailableChef()` function for different assignment strategies

### **Status Update Intervals**

Chef status embed updates automatically on status changes

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

If you need help:

1. Check this README thoroughly
2. Verify your `.env` configuration
3. Ensure proper Discord permissions
4. Check console logs for errors

---

**Built with ❤️ for efficient food delivery management**
Bot for ledger.dev
