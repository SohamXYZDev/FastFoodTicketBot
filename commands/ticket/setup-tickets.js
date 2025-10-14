const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-tickets')
        .setDescription('Send the ticket creation embed (Admin only)'),
    
    async execute(interaction, client, db) {
        // Check admin permissions
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasAdminRole = member.roles.cache.has(process.env.ADMIN_ROLE_ID);
        const isAdmin = member.permissions.has('Administrator');
        
        if (!hasAdminRole && !isAdmin) {
            return interaction.reply({ 
                content: 'You need admin permissions to use this command!', 
                ephemeral: true 
            });
        }
        
        // Create the ticket embed
        const embed = new EmbedBuilder()
            .setTitle('Start Order')
            .setDescription('**How to Order**\nClick the button below and complete the form to place your order!\n\nPayment Methods Accepted:\n-# PayPal · Venmo · Apple Pay · Zelle · Cash App · Crypto')
            .setColor('#005EFF')
            .setThumbnail('https://media.discordapp.net/attachments/1424068610355363963/1427324660810256474/ChatGPT_Image_Oct_13_2025_03_11_27_AM.png');

        // Create buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket_doordash')
                    .setLabel('🚪 DoorDash')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('create_ticket_ubereats')
                    .setLabel('🍔 UberEats')
                    .setStyle(ButtonStyle.Success)
            );

        await interaction.reply({ 
            content: '@everyone',
            embeds: [embed], 
            components: [row]
        });
    },
};