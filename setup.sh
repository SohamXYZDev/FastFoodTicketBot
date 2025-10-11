#!/bin/bash

echo "🍕 FastFood Ticket Bot Setup Script"
echo "=================================="
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "Please copy the .env file and configure it with your bot details."
    echo ""
    echo "Required configuration:"
    echo "- DISCORD_TOKEN (your bot token)"
    echo "- CLIENT_ID (your bot application ID)"
    echo "- GUILD_ID (your Discord server ID)"
    echo "- STATUS_CHANNEL_ID (channel for chef status)"
    echo "- TICKET_CATEGORY_ID (category for tickets)"
    echo "- CHEF_ROLE_ID (chef role ID)"
    echo "- ADMIN_ROLE_ID (admin role ID)"
    exit 1
fi

echo "✅ .env file found"

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo "✅ Dependencies installed"

# Deploy commands
echo "🚀 Deploying slash commands..."
npm run deploy

echo ""
echo "✅ Setup complete! Your bot is ready to use."
echo ""
echo "Next steps:"
echo "1. Start the bot: npm start"
echo "2. Use /setup-tickets in your ticket creation channel"
echo "3. Use /setup-status in your chef status channel"
echo "4. Add the Chef and Admin roles to appropriate users"
echo ""
echo "🎯 Happy cooking! 🍕"