require('dotenv').config();
const { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
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
            const orderType = 'Order';
            
            // Check if user already has an active ticket
            const existingTicket = Array.from(client.activeTickets.values()).find(ticket => ticket.userId === interaction.user.id);
            if (existingTicket) {
                return interaction.reply({ content: 'You already have an active ticket!', ephemeral: true });
            }

            // Check for available chefs
            const availableChef = await client.utils.getAvailableChef(orderType);
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

            // Store ticket info
            client.activeTickets.set(ticketChannel.id, {
                userId: interaction.user.id,
                chefId: availableChef.user_id,
                orderType: orderType,
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
                    { name: '⏰ Created', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setFooter({ text: 'Use /complete when the order is finished' });

            // High demand warning
            let content = '';
            if (client.utils.checkHighDemand()) {
                content = '⚠️ **High demand detected!** Please expect longer wait times.';
            }

            await ticketChannel.send({ content, embeds: [ticketEmbed] });

            await interaction.reply({ content: `Ticket created! Please head to ${ticketChannel}`, ephemeral: true });

            // Update chef status to busy if they have multiple tickets
            const chefTickets = Array.from(client.activeTickets.values()).filter(ticket => ticket.chefId === availableChef.user_id);
            if (chefTickets.length > 0) {
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