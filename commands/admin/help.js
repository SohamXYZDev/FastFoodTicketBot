const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands and their usage'),
    
    async execute(interaction, client, db) {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasChefRole = member.roles.cache.has(process.env.CHEF_ROLE_ID);
        const hasAdminRole = member.roles.cache.has(process.env.ADMIN_ROLE_ID);
        const isAdmin = member.permissions.has('Administrator');
        
        const embed = new EmbedBuilder()
            .setTitle('🍕 FastFood Ticket Bot - Help')
            .setDescription('Here are all the available commands:')
            .setColor('#00ADEF')
            .setThumbnail('https://media.discordapp.net/attachments/1424068610355363963/1427324660810256474/ChatGPT_Image_Oct_13_2025_03_11_27_AM.png')
            .setTimestamp();
        
        // Customer Commands
        embed.addFields({
            name: '👥 Customer Commands',
            value: '`/help` - Show this help message\n`/close [reason]` - Close your ticket\n\n*Use the ticket creation buttons to create orders*',
            inline: false
        });
        
        // Chef Commands
        if (hasChefRole || hasAdminRole || isAdmin) {
            embed.addFields({
                name: '👨‍🍳 Chef Commands',
                value: '`/chef [user] <status>` - Set chef status (OPEN/BUSY/CLOSED)\n`/complete <ordertype>` - Complete an order and add debt\n`/debt check [chef]` - Check your debt or another chef\'s\n`/history` - View your order history',
                inline: false
            });
        }
        
        // Admin Commands
        if (hasAdminRole || isAdmin) {
            embed.addFields({
                name: '👑 Admin Commands',
                value: '`/setup-tickets` - Send ticket creation embed\n`/setup-status` - Update chef status embed\n`/debt all` - View all chef debts\n`/debt clear <chef>` - Clear a chef\'s debt\n`/tickets` - View active ticket information\n`/history [chef]` - View order history for any chef',
                inline: false
            });
        }
        
        embed.addFields({
            name: '💡 Features',
            value: '• **Auto-assignment**: Chefs are automatically assigned to tickets\n• **Debt tracking**: All completed orders add to chef debt\n• **Status updates**: Live chef status dashboard\n• **High demand alerts**: Warning when 2+ tickets are active\n• **Auto-hiding**: Tickets hide when chefs go offline',
            inline: false
        });
        
        embed.addFields({
            name: '💰 Pricing',
            value: `🚪 **DoorDash**: $${process.env.DOORDASH_AMOUNT} per order\n🍔 **UberEats**: $${process.env.UBEREATS_AMOUNT} per order`,
            inline: false
        });
        
        embed.setFooter({ 
            text: `${hasAdminRole || isAdmin ? 'Admin' : hasChefRole ? 'Chef' : 'Customer'} • FastFood Delivery Service` 
        });
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};