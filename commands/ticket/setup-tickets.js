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
            .setTitle('🎫 Create a Delivery Ticket')
            .setDescription('Click the button below to create a ticket for your delivery order. Our chefs will assist you!')
            .setColor('#FF6B35')
            .addFields(
                { 
                    name: '🚪 DoorDash Orders', 
                    value: `• $${process.env.DOORDASH_AMOUNT} per order\n• Red button below`, 
                    inline: true 
                },
                { 
                    name: '🍔 UberEats Orders', 
                    value: `• $${process.env.UBEREATS_AMOUNT} per order\n• Green button below`, 
                    inline: true 
                },
                { 
                    name: '📋 Instructions', 
                    value: '1. Choose your delivery platform\n2. Wait for chef assignment\n3. Provide your order details\n4. Complete your order', 
                    inline: false 
                }
            )
            .setFooter({ text: '🍕 FastFood Delivery Service • Quick & Reliable' })
            .setTimestamp();

        // Create buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket_doordash')
                    .setLabel('🚪 DoorDash Ticket')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('create_ticket_ubereats')
                    .setLabel('🍔 UberEats Ticket')
                    .setStyle(ButtonStyle.Success)
            );

        await interaction.reply({ 
            embeds: [embed], 
            components: [row]
        });
    },
};