const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('View order history')
        .addUserOption(option =>
            option.setName('chef')
                .setDescription('View history for specific chef (Admin only)')
                .setRequired(false)),
    
    async execute(interaction, client, db) {
        const targetChef = interaction.options.getUser('chef');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasAdminRole = member.roles.cache.has(process.env.ADMIN_ROLE_ID);
        const isAdmin = member.permissions.has('Administrator');
        
        // Check permissions for viewing other chef's history
        if (targetChef && !hasAdminRole && !isAdmin) {
            return interaction.reply({ 
                content: 'You need admin permissions to view other chefs\' history!', 
                ephemeral: true 
            });
        }
        
        try {
            const orders = await db.getOrderHistory(targetChef?.id);
            
            if (orders.length === 0) {
                return interaction.reply({ 
                    content: targetChef ? `No order history found for ${targetChef}!` : 'No order history found!', 
                    ephemeral: true 
                });
            }
            
            const embed = new EmbedBuilder()
                .setTitle(`📋 Order History${targetChef ? ` - ${targetChef.username}` : ''}`)
                .setColor('#00ADEF')
                .setThumbnail('https://media.discordapp.net/attachments/1424068610355363963/1427324660810256474/ChatGPT_Image_Oct_13_2025_03_11_27_AM.png')
                .setTimestamp();
            
            let historyText = '';
            let totalAmount = 0;
            let doorDashCount = 0;
            let uberEatsCount = 0;
            
            const recentOrders = orders.slice(0, 10); // Show last 10 orders
            
            for (const order of recentOrders) {
                const completedTime = new Date(order.completed_at);
                const timeStr = Math.floor(completedTime.getTime() / 1000);
                
                historyText += `**${order.order_type}** - $${order.amount.toFixed(2)}\n`;
                historyText += `Chef: <@${order.chef_id}> | Customer: <@${order.customer_id}>\n`;
                historyText += `Completed: <t:${timeStr}:R>\n\n`;
                
                totalAmount += order.amount;
                if (order.order_type.toLowerCase() === 'doordash') doorDashCount++;
                else uberEatsCount++;
            }
            
            embed.setDescription(historyText);
            embed.addFields(
                { name: '💰 Total Amount', value: `$${totalAmount.toFixed(2)}`, inline: true },
                { name: '🚪 DoorDash', value: `${doorDashCount} orders`, inline: true },
                { name: '🍔 UberEats', value: `${uberEatsCount} orders`, inline: true }
            );
            
            if (orders.length > 10) {
                embed.setFooter({ text: `Showing 10 of ${orders.length} total orders` });
            }
            
            await interaction.reply({ embeds: [embed], ephemeral: !hasAdminRole && !isAdmin });
            
        } catch (error) {
            console.error('Error getting order history:', error);
            await interaction.reply({ 
                content: 'There was an error getting the order history!', 
                ephemeral: true 
            });
        }
    },
};