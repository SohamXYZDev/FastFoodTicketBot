const mongoose = require('mongoose');

// Chef Schema
const chefSchema = new mongoose.Schema({
    user_id: { 
        type: String, 
        required: true, 
        unique: true 
    },
    username: { 
        type: String, 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['OPEN', 'BUSY', 'CLOSED'], 
        default: 'CLOSED' 
    },
    debt_amount: { 
        type: Number, 
        default: 0 
    },
    total_completed: { 
        type: Number, 
        default: 0 
    },
    created_at: { 
        type: Date, 
        default: Date.now 
    }
});

// Order Schema
const orderSchema = new mongoose.Schema({
    chef_id: { 
        type: String, 
        required: true 
    },
    customer_id: { 
        type: String, 
        required: true 
    },
    order_type: { 
        type: String, 
        enum: ['doordash', 'ubereats'], 
        required: true 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    completed_at: { 
        type: Date, 
        default: Date.now 
    }
});

// Create Models
const Chef = mongoose.model('Chef', chefSchema);
const Order = mongoose.model('Order', orderSchema);

class Database {
    constructor() {
        this.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastfood-ticket-bot';
        this.Chef = Chef;
        this.Order = Order;
    }

    async initialize() {
        try {
            await mongoose.connect(this.mongoUri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });
            console.log('✅ Connected to MongoDB database');
        } catch (error) {
            console.error('❌ Error connecting to MongoDB:', error);
            throw error;
        }
    }

    async addChef(userId, username) {
        try {
            const chef = await this.Chef.findOneAndUpdate(
                { user_id: userId },
                { user_id: userId, username: username },
                { upsert: true, new: true }
            );
            return chef._id;
        } catch (error) {
            console.error('Error adding/updating chef:', error);
            throw error;
        }
    }

    async updateChefStatus(userId, status) {
        try {
            const result = await this.Chef.updateOne(
                { user_id: userId },
                { status: status }
            );
            return result.modifiedCount;
        } catch (error) {
            console.error('Error updating chef status:', error);
            throw error;
        }
    }

    async addDebt(chefId, amount, orderType, customerId) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Add to debt and increment total completed
            await this.Chef.updateOne(
                { user_id: chefId },
                { 
                    $inc: { 
                        debt_amount: amount,
                        total_completed: 1
                    }
                },
                { session }
            );

            // Create order record
            const order = new this.Order({
                chef_id: chefId,
                customer_id: customerId,
                order_type: orderType.toLowerCase(),
                amount: amount
            });

            await order.save({ session });
            await session.commitTransaction();
            
            return order._id;
        } catch (error) {
            await session.abortTransaction();
            console.error('Error adding debt and order:', error);
            throw error;
        } finally {
            session.endSession();
        }
    }

    async getChefDebt(userId) {
        try {
            const chef = await this.Chef.findOne({ user_id: userId });
            return chef;
        } catch (error) {
            console.error('Error getting chef debt:', error);
            throw error;
        }
    }

    async getChef(userId) {
        try {
            const chef = await this.Chef.findOne({ user_id: userId });
            return chef;
        } catch (error) {
            console.error('Error getting chef:', error);
            throw error;
        }
    }

    async getAllChefs() {
        try {
            const chefs = await this.Chef.find({}).sort({ username: 1 });
            return chefs;
        } catch (error) {
            console.error('Error getting all chefs:', error);
            throw error;
        }
    }

    async getAllDebts() {
        try {
            const chefs = await this.Chef.find({ debt_amount: { $gt: 0 } })
                .sort({ debt_amount: -1 });
            return chefs;
        } catch (error) {
            console.error('Error getting all debts:', error);
            throw error;
        }
    }

    async clearChefDebt(userId) {
        try {
            const result = await this.Chef.updateOne(
                { user_id: userId },
                { debt_amount: 0 }
            );
            return result.modifiedCount;
        } catch (error) {
            console.error('Error clearing chef debt:', error);
            throw error;
        }
    }

    async getOrderHistory(chefId = null) {
        try {
            let query = {};
            if (chefId) {
                query.chef_id = chefId;
            }

            const orders = await this.Order.find(query)
                .sort({ completed_at: -1 })
                .limit(50);
            return orders;
        } catch (error) {
            console.error('Error getting order history:', error);
            throw error;
        }
    }

    async close() {
        try {
            await mongoose.connection.close();
            console.log('MongoDB connection closed');
        } catch (error) {
            console.error('Error closing MongoDB connection:', error);
        }
    }
}

module.exports = Database;