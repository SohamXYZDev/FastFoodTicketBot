require('dotenv').config();
const { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('./database.js');
const { chromium } = require('playwright');

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Initialize database
const db = new Database();

// Create a collection for commands
client.commands = new Collection();

// Load commands
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// Store active tickets and chef statuses
client.activeTickets = new Map();
client.chefStatuses = new Map();

// Utility functions
client.utils = {
    updateChefStatusEmbed: async () => {
        try {
            const guild = client.guilds.cache.get(process.env.GUILD_ID);
            if (!guild) {
                console.log('⚠️ GUILD_ID not configured or bot not in guild - skipping chef status update');
                return;
            }
            
            const statusChannel = guild.channels.cache.get(process.env.STATUS_CHANNEL_ID);
            if (!statusChannel) {
                console.log('⚠️ STATUS_CHANNEL_ID not configured or channel not found - skipping chef status update');
                return;
            }

        // Get all chefs from database
        const chefs = await db.getAllChefs();
        
        const embed = new EmbedBuilder()
            .setTitle('🍳 Chef Status Dashboard')
            .setDescription('Current status of all delivery chefs')
            .setColor('#00ADEF')
            .setThumbnail('https://media.discordapp.net/attachments/1424068610355363963/1427324660810256474/ChatGPT_Image_Oct_13_2025_03_11_27_AM.png')
            .setTimestamp();

        let chefList = '';
        
        const statusEmojis = {
            'OPEN': '🟢',
            'BUSY': '🟡', 
            'CLOSED': '🔴'
        };

        chefs.forEach(chef => {
            const status = chef.status || 'CLOSED';
            const emoji = statusEmojis[status];
            chefList += `${emoji} <@${chef.user_id}> - ${status}\n`;
        });

        embed.addFields(
            { name: '👨‍� Available Chefs', value: chefList || 'No chefs registered', inline: false }
        );

        embed.addFields({
            name: '📊 Summary',
            value: `📱 ${chefs.filter(c => c.status === 'OPEN').length}/4 chefs currently open\n🟢 = Open for orders\n🟡 = Busy (limited orders)\n🔴 = Closed\n\nQuickEats • Updated automatically`,
            inline: false
        });

        // Try to find existing status message and update it
        const messages = await statusChannel.messages.fetch({ limit: 10 });
        const statusMessage = messages.find(msg => 
            msg.author.id === client.user.id && 
            msg.embeds[0]?.title === '🍳 Chef Status Dashboard'
        );

        if (statusMessage) {
            await statusMessage.edit({ embeds: [embed] });
        } else {
            await statusChannel.send({ embeds: [embed] });
        }
        } catch (error) {
            console.log('⚠️ Error updating chef status embed:', error.message);
        }
    },

    getAvailableChef: async (orderType) => {
        const chefs = await db.getAllChefs();
        const availableChefs = chefs.filter(chef => chef.status === 'OPEN');
        
        if (availableChefs.length === 0) return null;
        
        // Simple round-robin assignment (you can implement more complex logic)
        return availableChefs[0];
    },

    checkHighDemand: () => {
        return client.activeTickets.size >= 2;
    },

    completeOrder: async (channelId, chefId, customerId, total) => {
        try {
            // Add debt to chef
            const amount = parseFloat(total.replace(/[^0-9.]/g, '')) || 4.50;
            await db.addDebt(chefId, amount, 'ubereats', customerId);
            
            // Remove from active tickets
            if (client.activeTickets.has(channelId)) {
                const ticket = client.activeTickets.get(channelId);
                ticket.completed = true;
                
                // Remove from active tickets
                client.activeTickets.delete(channelId);
                
                // Check if chef should be set back to OPEN
                const chefTickets = Array.from(client.activeTickets.values()).filter(t => t.chefId === chefId);
                if (chefTickets.length === 0) {
                    await db.updateChefStatus(chefId, 'OPEN');
                    await client.utils.updateChefStatusEmbed();
                }
            }
            
            return true;
        } catch (error) {
            console.error('Error completing order:', error);
            throw error;
        }
    }
};

// UberEats Group Order Scraper Function
async function scrapeUberEats(groupOrderUrl, statusMessage = null) {
    const updateStatus = async (text) => {
        if (statusMessage) {
            try {
                await statusMessage.edit(text);
            } catch (error) {
                console.error('Error updating status message:', error);
            }
        }
    };

    const resultData = {
        draftOrderUuid: null,
        storeName: null,
        deliveryAddress: null,
        subtotal: null,
        items: []
    };

    try {
        await updateStatus('🔍 Loading order details...');

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        // Capture API responses
        const capturedApiData = [];
        page.on('response', async response => {
            try {
                const url = response.url();
                if (url.includes('getDraftOrderByUuidV2') || url.includes('createGroupOrderDraftV2')) {
                    const data = await response.json();
                    capturedApiData.push(data);
                }
            } catch (error) {
                // Ignore errors from parsing responses
            }
        });

        // Navigate to the page
        await page.goto(groupOrderUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Extract Store and Delivery Address
        await updateStatus('📍 Getting restaurant info...');
        const divs = await page.locator('div.bo.bp.co.dy').all();

        for (let i = 0; i < divs.length; i++) {
            const text = (await divs[i].innerText()).trim();
            if (text) {
                if (i === 0 && !resultData.storeName) {
                    const lines = text.split('\n');
                    resultData.storeName = lines[0] || text;
                } else if (i === 1 && !resultData.deliveryAddress) {
                    const lines = text.split('\n');
                    resultData.deliveryAddress = lines[0] || text;
                }
            }
        }

        // Extract draftOrderUuid from URL
        if (groupOrderUrl.includes('/group-orders/')) {
            const uuid = groupOrderUrl.split('/group-orders/')[1].split('/')[0];
            resultData.draftOrderUuid = uuid;
        }

        // Join as guest
        await updateStatus('🔐 Accessing order...');
        try {
            await page.waitForSelector("input[type='text']", { timeout: 5000 });
            await page.fill("input[type='text']", "Discord Bot");
            await page.waitForTimeout(500);
        } catch (error) {
            // Input might not be required
        }

        // Click "Join order" button
        try {
            const joinButton = page.getByRole('button', { name: 'Join order' });
            if (await joinButton.count() > 0) {
                await joinButton.click();
                await page.waitForTimeout(3000);
            }
        } catch (error) {
            // Button might not exist
        }

        // Click "View Order" button
        await updateStatus('🛒 Loading cart items...');
        try {
            const elements = await page.locator('a, button').all();
            for (const element of elements) {
                const text = await element.innerText();
                if (text.toLowerCase().includes('view order')) {
                    await element.click();
                    await page.waitForTimeout(5000);
                    break;
                }
            }
        } catch (error) {
            // Might not need to click
        }

        // Parse API data for cart items
        if (capturedApiData.length > 0) {
            for (const apiResponse of capturedApiData) {
                const data = apiResponse.data || {};
                const draftOrder = data.draftOrder || {};

                if (draftOrder) {
                    const shoppingCart = draftOrder.shoppingCart || {};

                    if (shoppingCart) {
                        const items = shoppingCart.items || [];

                        if (items.length > 0 && resultData.items.length === 0) {
                            await updateStatus(`✅ Found ${items.length} item${items.length !== 1 ? 's' : ''}`);
                            let total = 0;

                            for (const item of items) {
                                const itemName = item.title || 'Unknown Item';
                                const itemQty = item.quantity || 1;
                                const itemPrice = item.price || 0;

                                // Convert price from cents to dollars
                                const itemPriceDollars = itemPrice / 100;
                                total += itemPriceDollars * itemQty;

                                resultData.items.push({
                                    name: itemName,
                                    qty: itemQty,
                                    price: itemPriceDollars
                                });
                            }

                            resultData.subtotal = Math.round(total * 100) / 100;
                            await updateStatus(`💰 Total: $${resultData.subtotal.toFixed(2)}`);
                            break;
                        }
                    }
                }
            }
        }

        await updateStatus('✨ Preparing results...');
        await browser.close();

        return resultData;
    } catch (error) {
        await updateStatus(`❌ Error: ${error.message}`);
        console.error('Error scraping UberEats:', error);
        return null;
    }
}

// When the client is ready, run this code
client.once('ready', async () => {
    console.log(`Ready! Logged in as ${client.user.tag}`);
    
    // Initialize database
    await db.initialize();
    
    // Load active tickets from database into memory
    const activeTickets = await db.getAllActiveTickets();
    console.log(`📋 Loading ${activeTickets.length} active tickets from database...`);
    
    for (const ticket of activeTickets) {
        client.activeTickets.set(ticket.channel_id, {
            userId: ticket.user_id,
            chefId: ticket.chef_id,
            orderType: ticket.order_type,
            groupOrderLink: ticket.group_order_link,
            total: ticket.total,
            specialInstructions: ticket.special_instructions,
            createdAt: ticket.created_at,
            claimed: ticket.claimed,
            completed: ticket.completed,
            claimedAt: ticket.claimed_at
        });
    }
    
    console.log(`✅ Loaded ${client.activeTickets.size} active tickets into memory`);
    
    // Update chef status embed on startup (only if configured)
    try {
        await client.utils.updateChefStatusEmbed();
    } catch (error) {
        console.log('⚠️ Could not update chef status embed:', error.message);
    }
});

// Handle messages for auto-completion and customer role assignment
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    // Check if message is in an unclaimed ticket channel
    if (client.activeTickets.has(message.channel.id)) {
        const ticket = client.activeTickets.get(message.channel.id);
        
        // If ticket is unclaimed and message is from a chef (not the customer)
        if (!ticket.claimed && message.author.id !== ticket.userId) {
            const chefRole = message.guild.roles.cache.get(process.env.CHEF_ROLE_ID);
            
            // Check if author is a chef
            if (chefRole && message.member.roles.cache.has(chefRole.id)) {
                try {
                    await message.delete();
                    
                    // Send ephemeral-style message that deletes itself
                    const warningMsg = await message.channel.send(`<@${message.author.id}> ⚠️ You must claim this order before chatting!`);
                    setTimeout(() => warningMsg.delete().catch(() => {}), 3000);
                } catch (error) {
                    console.error('Error deleting chef message in unclaimed ticket:', error);
                }
                return;
            }
        }
    }
    
    // Check if message contains UberEats group order link (server-wide)
    const uberEatsPattern = /https:\/\/eats\.uber\.com\/group-orders\/[a-f0-9-]+\/join/i;
    const match = message.content.match(uberEatsPattern);
    
    if (match) {
        const url = match[0];
        
        // Send initial "processing" message
        const processingMsg = await message.channel.send('🔍 Starting scrape...');
        
        try {
            // Scrape the order
            const data = await scrapeUberEats(url, processingMsg);
            
            if (data && data.items && data.items.length > 0) {
                // Create embed with order details
                const embed = new EmbedBuilder()
                    .setTitle('🍔 Uber Eats Group Order')
                    .setDescription(`**${data.storeName || 'Unknown Store'}**`)
                    .setColor('#00FF00'); // Green color
                
                // Add delivery address
                if (data.deliveryAddress) {
                    embed.addFields({
                        name: '📍 Delivery Address',
                        value: data.deliveryAddress,
                        inline: false
                    });
                }
                
                // Add items
                if (data.items) {
                    let itemsText = '';
                    for (const item of data.items) {
                        itemsText += `**${item.name}**\n`;
                        itemsText += `Quantity: ${item.qty} × $${item.price.toFixed(2)}\n\n`;
                    }
                    
                    embed.addFields({
                        name: '🛒 Items',
                        value: itemsText,
                        inline: false
                    });
                }
                
                // Add subtotal
                if (data.subtotal) {
                    embed.addFields({
                        name: '💰 Subtotal',
                        value: `**$${data.subtotal.toFixed(2)}**`,
                        inline: false
                    });
                }
                
                // Add order UUID
                if (data.draftOrderUuid) {
                    embed.setFooter({ text: `Order ID: ${data.draftOrderUuid}` });
                }
                
                // Delete processing message and send embed
                await processingMsg.delete();
                await message.channel.send({ embeds: [embed] });
                
            } else if (data && data.storeName) {
                // Order exists but has no items yet
                await processingMsg.edit(`⚠️ **Order found but cart is empty!**\n` +
                    `🏪 Store: ${data.storeName}\n` +
                    `📍 Delivery: ${data.deliveryAddress || 'N/A'}\n\n` +
                    `ℹ️ This order has no items added yet.`);
            } else {
                await processingMsg.edit('❌ Could not extract order data. The link might be invalid or expired.');
            }
        } catch (error) {
            console.error('Error processing UberEats link:', error);
            await processingMsg.edit(`❌ Error scraping order: ${error.message}`);
        }
    }
    
    // Check if message contains UberEats order link (existing ticket completion logic)
    if (message.content.includes('https://ubereats.com/orders/')) {
        console.log('🔍 Detected UberEats order completion link');
        const channelId = message.channel.id;
        
        // Check if this is a ticket channel
        if (client.activeTickets.has(channelId)) {
            console.log('✅ Channel is an active ticket');
            const ticket = client.activeTickets.get(channelId);
            console.log(`👤 Message author: ${message.author.id}, Chef: ${ticket.chefId}, Claimed: ${ticket.claimed}, Completed: ${ticket.completed}`);
            
            // Check if sender is the assigned chef and ticket is claimed
            if (ticket.chefId === message.author.id && ticket.claimed && !ticket.completed) {
                console.log('✅ All conditions met - auto-completing order');
                try {
                    // Get payment amount from environment
                    const amount = parseFloat(process.env.UBEREATS_AMOUNT) || 4.50;
                    
                    // Add debt to chef
                    await db.addDebt(ticket.chefId, amount, 'ubereats', ticket.userId);
                    
                    // Mark ticket as completed
                    ticket.completed = true;
                    
                    // Move to completed category and rename
                    const guild = message.guild;
                    const completedCategory = guild.channels.cache.get('1427368396197990550');
                    const customer = await client.users.fetch(ticket.userId);
                    const newName = `completed-${customer.username}`;
                    
                    await message.channel.edit({
                        name: newName,
                        parent: completedCategory
                    });
                    
                    // Create completion embed
                    const embed = new EmbedBuilder()
                        .setTitle('✅ Order Auto-Completed!')
                        .setDescription(`Order automatically completed when chef shared the UberEats link`)
                        .setColor('#00ADEF')
                        .setThumbnail('https://i.ibb.co/fYkrgwKy/Chat-GPT-Image-Oct-13-2025-12-09-59-PM.png')
                        .addFields(
                            { name: '💰 Amount', value: `$${amount.toFixed(2)}`, inline: true },
                            { name: '👨‍🍳 Chef', value: `<@${ticket.chefId}>`, inline: true },
                            { name: '🛍️ Customer', value: `<@${ticket.userId}>`, inline: true },
                            { name: '⏰ Completed', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                        )
                        .setFooter({ text: 'Thank you for your order! Moved to completed category.' })
                        .setTimestamp();
                    
                    await message.channel.send({ embeds: [embed] });
                    
                    // Add customer role to the user who opened ticket
                    try {
                        const guild = message.guild;
                        const member = await guild.members.fetch(ticket.userId);
                        const customerRole = guild.roles.cache.get('1404345557022937130');
                        
                        if (customerRole && !member.roles.cache.has(customerRole.id)) {
                            await member.roles.add(customerRole);
                        }
                    } catch (error) {
                        console.log('Could not add customer role:', error.message);
                    }
                    
                    // Check if chef should be set back to OPEN
                    const chefTickets = Array.from(client.activeTickets.values())
                        .filter(t => t.chefId === ticket.chefId && !t.completed);
                    
                    if (chefTickets.length <= 1) {
                        await db.updateChefStatus(ticket.chefId, 'OPEN');
                        await client.utils.updateChefStatusEmbed();
                    }
                    
                    // Remove from active tickets in memory and database
                    client.activeTickets.delete(channelId);
                    await db.deleteActiveTicket(channelId);
                    
                } catch (error) {
                    console.error('❌ Error auto-completing order:', error);
                }
            } else {
                console.log('❌ Conditions not met for autocomplete:', {
                    isChef: ticket.chefId === message.author.id,
                    isClaimed: ticket.claimed,
                    notCompleted: !ticket.completed
                });
            }
        } else {
            console.log('❌ Channel is not an active ticket');
        }
    }
});

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction, client, db);
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        }
    } else if (interaction.isButton()) {
        // Handle button interactions
        if (interaction.customId === 'create_ticket_ubereats') {
            // Check if user already has an active ticket
            const existingTicket = Array.from(client.activeTickets.values()).find(ticket => ticket.userId === interaction.user.id);
            if (existingTicket) {
                return interaction.reply({ content: 'You already have an active ticket!', ephemeral: true });
            }

            // No need to check for available chefs since orders will be claimed later

            // Show modal form for order details
            const modal = new ModalBuilder()
                .setCustomId('order_form')
                .setTitle('Order Details');

            const groupOrderLinkInput = new TextInputBuilder()
                .setCustomId('group_order_link')
                .setLabel('Group Order Link')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Paste your UberEats group order link here')
                .setRequired(true);

            const totalInput = new TextInputBuilder()
                .setCustomId('total')
                .setLabel('Total Amount')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. $15.50')
                .setRequired(true);

            const specialInstructionsInput = new TextInputBuilder()
                .setCustomId('special_instructions')
                .setLabel('Special Instructions')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Any special instructions or dietary requirements...')
                .setRequired(false)
                .setMaxLength(1000);

            const firstActionRow = new ActionRowBuilder().addComponents(groupOrderLinkInput);
            const secondActionRow = new ActionRowBuilder().addComponents(totalInput);
            const thirdActionRow = new ActionRowBuilder().addComponents(specialInstructionsInput);

            modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

            await interaction.showModal(modal);
        } else if (interaction.customId === 'claim_order') {
            // Check if this is a ticket channel
            if (!client.activeTickets.has(interaction.channel.id)) {
                return interaction.reply({ content: 'This is not an active ticket channel!', ephemeral: true });
            }

            const ticket = client.activeTickets.get(interaction.channel.id);
            
            // Check if order is already claimed
            if (ticket.claimed) {
                return interaction.reply({ content: 'This order has already been claimed!', ephemeral: true });
            }

            // Check if user is a chef
            const chefRole = interaction.guild.roles.cache.get(process.env.CHEF_ROLE_ID);
            if (!chefRole || !interaction.member.roles.cache.has(chefRole.id)) {
                return interaction.reply({ content: 'Only chefs can claim orders!', ephemeral: true });
            }

            // Check chef availability
            const chefData = await db.getChef(interaction.user.id);
            if (!chefData || chefData.status === 'OFFLINE') {
                return interaction.reply({ content: 'You must be available to claim orders! Use `/chef status available` first.', ephemeral: true });
            }

            // Check if this is first click or confirmation
            if (!ticket.claimConfirmation || ticket.claimConfirmation !== interaction.user.id) {
                // First click - ask for confirmation with a button
                ticket.claimConfirmation = interaction.user.id;
                client.activeTickets.set(interaction.channel.id, ticket);
                
                const confirmButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('confirm_claim')
                            .setLabel('Confirm Claim')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('✅')
                    );
                
                return interaction.reply({ 
                    content: '⚠️ **Click "Confirm Claim" below to confirm claiming this order**', 
                    components: [confirmButton],
                    ephemeral: true 
                });
            }

            // This shouldn't be reached anymore since we use confirm_claim button
            // But keeping for backward compatibility
            delete ticket.claimConfirmation;

            // Move channel to regular ticket category and assign chef
            const ticketCategory = interaction.guild.channels.cache.get('1432763201409253411');
            
            await interaction.channel.edit({
                name: `ticket-${interaction.guild.members.cache.get(ticket.userId).user.username}`,
                parent: ticketCategory,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: ticket.userId,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                ]
            });

            // Update ticket data in memory and database
            ticket.chefId = interaction.user.id;
            ticket.claimed = true;
            ticket.claimedAt = new Date();
            client.activeTickets.set(interaction.channel.id, ticket);
            
            await db.updateActiveTicket(interaction.channel.id, {
                chef_id: interaction.user.id,
                claimed: true,
                claimed_at: new Date()
            });

            // Create new embed showing claimed status
            const claimedEmbed = new EmbedBuilder()
                .setTitle(`🎫 Order Claimed!`)
                .setDescription(`<@${interaction.user.id}> has claimed this order for <@${ticket.userId}>!`)
                .setColor('#00ADEF') // Blue color for claimed
                .setThumbnail('https://i.ibb.co/fYkrgwKy/Chat-GPT-Image-Oct-13-2025-12-09-59-PM.png')
                .addFields(
                    { name: '👨‍🍳 Assigned Chef', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '💰 Total Amount', value: ticket.total, inline: true },
                    { name: '⏰ Claimed', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '🔗 Group Order Link', value: ticket.groupOrderLink, inline: false },
                    { name: '📝 Special Instructions', value: ticket.specialInstructions, inline: false }
                )
                .setFooter({ text: 'Send a UberEats link when order is complete!' });

            // Complete order and close ticket buttons for the assigned chef
            const actionButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('complete_order')
                        .setLabel('Complete Order')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒')
                );

            await interaction.update({
                content: `<@${ticket.userId}> <@${interaction.user.id}>`,
                embeds: [claimedEmbed],
                components: [actionButtons]
            });

            // Update chef status to busy if they have multiple tickets
            const chefTickets = Array.from(client.activeTickets.values()).filter(t => t.chefId === interaction.user.id && t.claimed);
            if (chefTickets.length > 1) {
                await db.updateChefStatus(interaction.user.id, 'BUSY');
                await client.utils.updateChefStatusEmbed();
            }

        } else if (interaction.customId === 'confirm_claim') {
            // Handle the confirmation claim button from ephemeral message
            const channelId = interaction.message.channelId;
            
            if (!client.activeTickets.has(channelId)) {
                return interaction.update({ content: '❌ This ticket is no longer active!', components: [] });
            }

            const ticket = client.activeTickets.get(channelId);
            
            // Verify the confirmation is from the chef who initiated the claim
            if (!ticket.claimConfirmation || ticket.claimConfirmation !== interaction.user.id) {
                return interaction.update({ content: '❌ Claim confirmation expired. Please click "Claim Order" again.', components: [] });
            }

            // Check if order is already claimed by someone else
            if (ticket.claimed) {
                delete ticket.claimConfirmation;
                client.activeTickets.set(channelId, ticket);
                return interaction.update({ content: '❌ This order has already been claimed by someone else!', components: [] });
            }

            // Proceed with claim
            delete ticket.claimConfirmation;
            
            const ticketChannel = interaction.guild.channels.cache.get(channelId);
            const ticketCategory = interaction.guild.channels.cache.get('1432763201409253411');
            
            await ticketChannel.edit({
                name: `ticket-${interaction.guild.members.cache.get(ticket.userId).user.username}`,
                parent: ticketCategory,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: ticket.userId,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                ]
            });

            // Update ticket data
            ticket.chefId = interaction.user.id;
            ticket.claimed = true;
            ticket.claimedAt = new Date();
            client.activeTickets.set(channelId, ticket);
            
            await db.updateActiveTicket(channelId, {
                chef_id: interaction.user.id,
                claimed: true,
                claimed_at: new Date()
            });

            // Create claimed embed
            const claimedEmbed = new EmbedBuilder()
                .setTitle(`🎫 Order Claimed!`)
                .setDescription(`<@${interaction.user.id}> has claimed this order for <@${ticket.userId}>!`)
                .setColor('#00ADEF')
                .setThumbnail('https://i.ibb.co/fYkrgwKy/Chat-GPT-Image-Oct-13-2025-12-09-59-PM.png')
                .addFields(
                    { name: '👨‍🍳 Assigned Chef', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '💰 Total Amount', value: ticket.total, inline: true },
                    { name: '⏰ Claimed', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '🔗 Group Order Link', value: ticket.groupOrderLink, inline: false },
                    { name: '📝 Special Instructions', value: ticket.specialInstructions, inline: false }
                )
                .setFooter({ text: 'Send a UberEats link when order is complete!' });

            const actionButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('complete_order')
                        .setLabel('Complete Order')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒')
                );

            // Update the ephemeral message
            await interaction.update({ content: '✅ **Order claimed successfully!**', components: [] });

            // Send the claimed message in the ticket channel
            await ticketChannel.send({
                content: `<@${ticket.userId}> <@${interaction.user.id}>`,
                embeds: [claimedEmbed],
                components: [actionButtons]
            });

            // Update chef status to busy if they have multiple tickets
            const chefTickets = Array.from(client.activeTickets.values()).filter(t => t.chefId === interaction.user.id && t.claimed);
            if (chefTickets.length > 1) {
                await db.updateChefStatus(interaction.user.id, 'BUSY');
                await client.utils.updateChefStatusEmbed();
            }

        } else if (interaction.customId === 'complete_order') {
            // Check if this is a ticket channel
            if (!client.activeTickets.has(interaction.channel.id)) {
                return interaction.reply({ content: 'This is not an active ticket channel!', ephemeral: true });
            }

            const ticket = client.activeTickets.get(interaction.channel.id);
            
            // Check if user is the chef assigned to this ticket
            if (interaction.user.id !== ticket.chefId) {
                return interaction.reply({ content: 'Only the assigned chef can complete this order!', ephemeral: true });
            }

            // Mark ticket as completed
            await client.utils.completeOrder(interaction.channel.id, interaction.user.id, ticket.userId, ticket.total);
            
            // Remove from database
            await db.deleteActiveTicket(interaction.channel.id);
            
            // Move to completed category and rename
            await interaction.reply({ content: 'Order marked as complete! Moving to completed category...' });
            
            const completedCategory = interaction.guild.channels.cache.get('1427368396197990550');
            const customer = await client.users.fetch(ticket.userId);
            
            await interaction.channel.edit({
                name: `completed-${customer.username}`,
                parent: completedCategory
            });
        } else if (interaction.customId === 'close_ticket') {
            // Check if this is a ticket channel
            if (!client.activeTickets.has(interaction.channel.id)) {
                return interaction.reply({ content: 'This is not an active ticket channel!', ephemeral: true });
            }

            const ticket = client.activeTickets.get(interaction.channel.id);
            
            // Check if user is the assigned chef or admin
            const isChef = interaction.user.id === ticket.chefId;
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            
            if (!isChef && !isAdmin) {
                return interaction.reply({ content: 'Only the assigned chef or an administrator can close this ticket!', ephemeral: true });
            }

            // Remove from active tickets
            client.activeTickets.delete(interaction.channel.id);
            await db.deleteActiveTicket(interaction.channel.id);

            // Check if chef should be set back to OPEN
            if (ticket.chefId) {
                const chefTickets = Array.from(client.activeTickets.values()).filter(t => t.chefId === ticket.chefId);
                if (chefTickets.length === 0) {
                    await db.updateChefStatus(ticket.chefId, 'OPEN');
                    await client.utils.updateChefStatusEmbed();
                }
            }

            // Send closing message
            const closeEmbed = new EmbedBuilder()
                .setTitle('🔒 Ticket Closed')
                .setDescription(`This ticket has been closed by <@${interaction.user.id}>`)
                .setColor('#FF6B35')
                .setTimestamp();

            await interaction.reply({ embeds: [closeEmbed] });

            // Delete channel after 5 seconds
            setTimeout(async () => {
                try {
                    await interaction.channel.delete('Ticket closed');
                } catch (error) {
                    console.error('Error deleting ticket channel:', error);
                }
            }, 5000);
        } else if (interaction.customId === 'cancel_order') {
            // Check if this is a ticket channel
            if (!client.activeTickets.has(interaction.channel.id)) {
                return interaction.reply({ content: 'This is not an active ticket channel!', ephemeral: true });
            }

            const ticket = client.activeTickets.get(interaction.channel.id);
            
            // Check if user is the customer who created the ticket or admin
            const isCustomer = interaction.user.id === ticket.userId;
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            
            if (!isCustomer && !isAdmin) {
                return interaction.reply({ content: 'Only the customer who created this order or an administrator can cancel it!', ephemeral: true });
            }

            // Check if order is already claimed
            if (ticket.claimed) {
                return interaction.reply({ content: 'This order has already been claimed and cannot be cancelled! Please contact the assigned chef.', ephemeral: true });
            }

            // Remove from active tickets
            client.activeTickets.delete(interaction.channel.id);
            await db.deleteActiveTicket(interaction.channel.id);

            // Send cancellation message
            const cancelEmbed = new EmbedBuilder()
                .setTitle('❌ Order Cancelled')
                .setDescription(`This order has been cancelled by <@${interaction.user.id}>`)
                .setColor('#FF6B35')
                .setTimestamp();

            await interaction.reply({ embeds: [cancelEmbed] });

            // Delete channel after 5 seconds
            setTimeout(async () => {
                try {
                    await interaction.channel.delete('Order cancelled');
                } catch (error) {
                    console.error('Error deleting ticket channel:', error);
                }
            }, 5000);
        }
    } else if (interaction.isModalSubmit()) {
        // Handle modal form submissions
        if (interaction.customId === 'order_form') {
            const groupOrderLink = interaction.fields.getTextInputValue('group_order_link');
            const total = interaction.fields.getTextInputValue('total');
            const specialInstructions = interaction.fields.getTextInputValue('special_instructions') || 'None';

            // Check if user already has an active ticket (double check)
            const existingTicket = Array.from(client.activeTickets.values()).find(ticket => ticket.userId === interaction.user.id);
            if (existingTicket) {
                return interaction.reply({ content: 'You already have an active ticket!', ephemeral: true });
            }

            // No need to check for available chefs since orders will be claimed later

            // Create ticket channel in unclaimed category
            const guild = interaction.guild;
            const unclaimedCategory = guild.channels.cache.get('1428055979676664058');
            
            const ticketChannel = await guild.channels.create({
                name: `unclaimed-${interaction.user.username}`,
                type: 0, // Text channel
                parent: unclaimedCategory,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    // Allow chefs to view unclaimed tickets
                    {
                        id: process.env.CHEF_ROLE_ID,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                ],
            });

            // Store ticket info with order details (unclaimed initially)
            const ticketData = {
                userId: interaction.user.id,
                chefId: null, // No chef assigned yet
                orderType: 'Order',
                groupOrderLink: groupOrderLink,
                total: total,
                specialInstructions: specialInstructions,
                createdAt: new Date(),
                claimed: false,
                completed: false
            };
            
            // Save to both memory and database
            client.activeTickets.set(ticketChannel.id, ticketData);
            await db.createActiveTicket(ticketChannel.id, ticketData);

            // Create ticket embed
            const ticketEmbed = new EmbedBuilder()
                .setTitle(`🎫 Unclaimed Order`)
                .setDescription(`New order from <@${interaction.user.id}> waiting to be claimed by a chef!`)
                .setColor('#FF6B35') // Orange color for unclaimed
                .setThumbnail('https://i.ibb.co/fYkrgwKy/Chat-GPT-Image-Oct-13-2025-12-09-59-PM.png')
                .addFields(
                    { name: '👨‍🍳 Status', value: '🔍 **Waiting for Chef**', inline: true },
                    { name: '💰 Total Amount', value: total, inline: true },
                    { name: '⏰ Created', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '🔗 Group Order Link', value: groupOrderLink, inline: false },
                    { name: '📝 Special Instructions', value: specialInstructions, inline: false }
                )
                .setFooter({ text: 'Chefs: Click "Claim Order" to take this order!' });

            // High demand warning
            let content = '';
            if (client.utils.checkHighDemand()) {
                content = '⚠️ **High demand detected!** Please expect longer wait times.';
            }

            await ticketChannel.send({ 
                content: `${content}\n<@${interaction.user.id}> 👨‍🍳 **Chefs, claim this order!**`, 
                embeds: [ticketEmbed] 
            });

            // Claim order button
            const claimButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('claim_order')
                        .setLabel('Claim Order')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🙋‍♂️'),
                    new ButtonBuilder()
                        .setCustomId('cancel_order')
                        .setLabel('Cancel Order')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌')
                );

            await ticketChannel.send({
                content: `<@&1420971588253126697>`, // Ping chef role
                embeds: [new EmbedBuilder()
                    .setDescription('🍳 **Chefs**: Click below to claim this order and move it to your workspace!')
                    .setColor('#FF6B35')],
                components: [claimButton]
            });

            // Assign customer role to user
            const customerRole = interaction.guild.roles.cache.get('1404345557022937130');
            if (customerRole && !interaction.member.roles.cache.has(customerRole.id)) {
                try {
                    await interaction.member.roles.add(customerRole);
                    console.log(`Added Customer role to ${interaction.user.username}`);
                } catch (error) {
                    console.error('Error adding Customer role:', error);
                }
            }

            await interaction.reply({ content: `Ticket created! Please head to ${ticketChannel}`, ephemeral: true });

            // No need to update chef status since order is unclaimed initially
        }
    }
});

// Handle channel deletion (ticket closing)
client.on('channelDelete', async channel => {
    if (client.activeTickets.has(channel.id)) {
        const ticket = client.activeTickets.get(channel.id);
        client.activeTickets.delete(channel.id);
        
        // Delete from database
        await db.deleteActiveTicket(channel.id);
        
        // Check if chef should be set back to OPEN
        const chefTickets = Array.from(client.activeTickets.values()).filter(t => t.chefId === ticket.chefId);
        if (chefTickets.length === 0 && ticket.chefId) {
            // Set chef back to OPEN if no more tickets
            db.updateChefStatus(ticket.chefId, 'OPEN').then(() => {
                client.utils.updateChefStatusEmbed();
            });
        }
    }
});

// Log in to Discord
client.login(process.env.DISCORD_TOKEN);