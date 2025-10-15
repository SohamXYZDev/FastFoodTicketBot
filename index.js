require('dotenv').config();
const { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('./database.js');

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
        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        const statusChannel = guild.channels.cache.get(process.env.STATUS_CHANNEL_ID);
        
        if (!statusChannel) return;

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
    }
};

// When the client is ready, run this code
client.once('ready', async () => {
    console.log(`Ready! Logged in as ${client.user.tag}`);
    
    // Initialize database
    await db.initialize();
    
    // Update chef status embed on startup
    await client.utils.updateChefStatusEmbed();
});

// Handle messages for auto-completion and customer role assignment
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    // Check if message contains UberEats order link
    if (message.content.includes('https://ubereats.com/orders/')) {
        const channelId = message.channel.id;
        
        // Check if this is a ticket channel
        if (client.activeTickets.has(channelId)) {
            const ticket = client.activeTickets.get(channelId);
            
            // Check if sender is the assigned chef
            if (ticket.chefId === message.author.id && !ticket.completed) {
                try {
                    // Get payment amount from environment
                    const amount = parseFloat(process.env.UBEREATS_AMOUNT) || 4.50;
                    
                    // Add debt to chef
                    await db.addDebt(ticket.chefId, amount, 'order', ticket.userId);
                    
                    // Mark ticket as completed
                    ticket.completed = true;
                    
                    // Rename channel to show completion
                    const customer = await client.users.fetch(ticket.userId);
                    const newName = `completed-${customer.username}`;
                    await message.channel.setName(newName);
                    
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
                        .setFooter({ text: 'Thank you for your order! This channel will be deleted in 30 seconds.' })
                        .setTimestamp();
                    
                    await message.channel.send({ embeds: [embed] });
                    
                    // Add customer role to the user who opened ticket
                    try {
                        const guild = message.guild;
                        const member = await guild.members.fetch(ticket.userId);
                        const customerRole = guild.roles.cache.find(role => role.name.toLowerCase().includes('customer'));
                        
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
                    
                    // Delete the channel after 30 seconds
                    setTimeout(async () => {
                        try {
                            client.activeTickets.delete(channelId);
                            await message.channel.delete();
                        } catch (error) {
                            console.error('Error deleting channel:', error);
                        }
                    }, 30000);
                    
                } catch (error) {
                    console.error('Error auto-completing order:', error);
                }
            }
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

            // Check for available chefs
            const availableChef = await client.utils.getAvailableChef('Order');
            if (!availableChef) {
                return interaction.reply({ content: 'No chefs are currently available. Please try again later.', ephemeral: true });
            }

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
            
            // Delete the channel after a short delay
            await interaction.reply({ content: 'Order marked as complete! This channel will be deleted in 5 seconds.' });
            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (error) {
                    console.error('Error deleting channel:', error);
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

            // Check for available chefs again
            const availableChef = await client.utils.getAvailableChef('Order');
            if (!availableChef) {
                return interaction.reply({ content: 'No chefs are currently available. Please try again later.', ephemeral: true });
            }

            // Create ticket channel
            const guild = interaction.guild;
            const category = guild.channels.cache.get(process.env.TICKET_CATEGORY_ID);
            
            const ticketChannel = await guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: 0, // Text channel
                parent: category,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                        id: availableChef.user_id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                ],
            });

            // Store ticket info with order details
            client.activeTickets.set(ticketChannel.id, {
                userId: interaction.user.id,
                chefId: availableChef.user_id,
                orderType: 'Order',
                groupOrderLink: groupOrderLink,
                total: total,
                specialInstructions: specialInstructions,
                createdAt: new Date(),
                completed: false
            });

            // Create ticket embed
            const ticketEmbed = new EmbedBuilder()
                .setTitle(`🎫 New Order Ticket`)
                .setDescription(`Welcome <@${interaction.user.id}>! Your chef <@${availableChef.user_id}> will assist you shortly.`)
                .setColor('#00ADEF')
                .setThumbnail('https://i.ibb.co/fYkrgwKy/Chat-GPT-Image-Oct-13-2025-12-09-59-PM.png')
                .addFields(
                    { name: '👨‍🍳 Assigned Chef', value: `<@${availableChef.user_id}>`, inline: true },
                    { name: '💰 Total Amount', value: total, inline: true },
                    { name: '⏰ Created', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '🔗 Group Order Link', value: groupOrderLink, inline: false },
                    { name: '📝 Special Instructions', value: specialInstructions, inline: false }
                )
                .setFooter({ text: 'Use /complete when the order is finished' });

            // High demand warning
            let content = '';
            if (client.utils.checkHighDemand()) {
                content = '⚠️ **High demand detected!** Please expect longer wait times.';
            }

            await ticketChannel.send({ 
                content: `${content}\n<@${interaction.user.id}> <@${availableChef.user_id}>`, 
                embeds: [ticketEmbed] 
            });

            // Complete order button
            const completeButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('complete_order')
                        .setLabel('Complete Order')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅')
                );

            await ticketChannel.send({
                embeds: [new EmbedBuilder()
                    .setDescription('When the order is complete, click the button below or send a UberEats link.')
                    .setColor('#00ADEF')],
                components: [completeButton]
            });

            // Assign customer role to user
            const customerRole = interaction.guild.roles.cache.find(role => role.name === 'Customer');
            if (customerRole && !interaction.member.roles.cache.has(customerRole.id)) {
                try {
                    await interaction.member.roles.add(customerRole);
                    console.log(`Added Customer role to ${interaction.user.username}`);
                } catch (error) {
                    console.error('Error adding Customer role:', error);
                }
            }

            await interaction.reply({ content: `Ticket created! Please head to ${ticketChannel}`, ephemeral: true });

            // Update chef status to busy only if they have multiple tickets
            const chefTickets = Array.from(client.activeTickets.values()).filter(ticket => ticket.chefId === availableChef.user_id);
            if (chefTickets.length > 1) {
                await db.updateChefStatus(availableChef.user_id, 'BUSY');
                await client.utils.updateChefStatusEmbed();
            }
        }
    }
});

// Handle channel deletion (ticket closing)
client.on('channelDelete', channel => {
    if (client.activeTickets.has(channel.id)) {
        const ticket = client.activeTickets.get(channel.id);
        client.activeTickets.delete(channel.id);
        
        // Check if chef should be set back to OPEN
        const chefTickets = Array.from(client.activeTickets.values()).filter(t => t.chefId === ticket.chefId);
        if (chefTickets.length === 0) {
            // Set chef back to OPEN if no more tickets
            db.updateChefStatus(ticket.chefId, 'OPEN').then(() => {
                client.utils.updateChefStatusEmbed();
            });
        }
    }
});

// Log in to Discord
client.login(process.env.DISCORD_TOKEN);