const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tickets')
        .setDescription('View active ticket information (Admin only)'),
    
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
        
        try {
            const activeTickets = Array.from(client.activeTickets.entries());
            
            if (activeTickets.length === 0) {
                return interaction.reply({ 
                    content: 'There are no active tickets!', 
                    ephemeral: true 
                });
            }
            
            const embed = new EmbedBuilder()
                .setTitle(`🎫 Active Tickets (${activeTickets.length})`)
                .setColor('#00ADEF')
                .setThumbnail('https://media.discordapp.net/attachments/1424068610355363963/1427324660810256474/ChatGPT_Image_Oct_13_2025_03_11_27_AM.png')
                .setTimestamp();
            
            let ticketList = '';
            
            for (const [channelId, ticket] of activeTickets) {
                const channel = client.channels.cache.get(channelId);
                const channelMention = channel ? `<#${channelId}>` : 'Unknown Channel';
                const createdTime = Math.floor(ticket.createdAt.getTime() / 1000);
                const status = ticket.completed ? '✅ Completed' : '🔄 Active';
                
                ticketList += `${status} ${channelMention}\n`;
                ticketList += `├ Customer: <@${ticket.userId}>\n`;
                ticketList += `├ Chef: <@${ticket.chefId}>\n`;
                ticketList += `├ Type: ${ticket.orderType}\n`;
                ticketList += `└ Created: <t:${createdTime}:R>\n\n`;
            }
            
            embed.setDescription(ticketList);
            
            // Add high demand warning if applicable
            if (client.utils.checkHighDemand()) {
                embed.addFields({ 
                    name: '⚠️ High Demand Alert', 
                    value: 'There are 2+ active tickets. Customers are seeing longer wait times.', 
                    inline: false 
                });
            }
            
            await interaction.reply({ embeds: [embed], ephemeral: true });
            
        } catch (error) {
            console.error('Error getting active tickets:', error);
            await interaction.reply({ 
                content: 'There was an error getting the ticket information!', 
                ephemeral: true 
            });
        }
    },
};