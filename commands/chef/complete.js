const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('complete')
        .setDescription('Mark an order as complete and log payment')
        .addStringOption(option =>
            option.setName('ordertype')
                .setDescription('Type of order completed')
                .setRequired(true)
                .addChoices(
                    { name: 'DoorDash', value: 'doordash' },
                    { name: 'UberEats', value: 'ubereats' }
                )),
    
    async execute(interaction, client, db) {
        const orderType = interaction.options.getString('ordertype');
        const channelId = interaction.channel.id;
        
        // Check if this is a ticket channel
        if (!client.activeTickets.has(channelId)) {
            return interaction.reply({ 
                content: 'This command can only be used in active ticket channels!', 
                ephemeral: true 
            });
        }
        
        const ticket = client.activeTickets.get(channelId);
        
        // Check if user is the assigned chef or has admin permissions
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasAdminRole = member.roles.cache.has(process.env.ADMIN_ROLE_ID);
        const isAdmin = member.permissions.has('Administrator');
        
        if (ticket.chefId !== interaction.user.id && !hasAdminRole && !isAdmin) {
            return interaction.reply({ 
                content: 'Only the assigned chef or admins can complete this order!', 
                ephemeral: true 
            });
        }
        
        if (ticket.completed) {
            return interaction.reply({ 
                content: 'This order has already been completed!', 
                ephemeral: true 
            });
        }
        
        try {
            // Get payment amounts from environment
            const amount = orderType === 'doordash' 
                ? parseFloat(process.env.DOORDASH_AMOUNT) 
                : parseFloat(process.env.UBEREATS_AMOUNT);
            
            // Add debt to chef
            await db.addDebt(ticket.chefId, amount, orderType, ticket.userId);
            
            // Mark ticket as completed
            ticket.completed = true;
            
            // Rename the channel to show completion
            const newName = `completed-${orderType}-${interaction.guild.members.cache.get(ticket.userId)?.user.username || 'unknown'}`;
            await interaction.channel.setName(newName);
            
            // Create completion embed
            const embed = new EmbedBuilder()
                .setTitle('✅ Order Completed!')
                .setDescription(`Order has been successfully completed by <@${ticket.chefId}>`)
                .setColor('#00FF00')
                .addFields(
                    { name: '📦 Order Type', value: orderType === 'doordash' ? 'DoorDash' : 'UberEats', inline: true },
                    { name: '💰 Amount', value: `$${amount.toFixed(2)}`, inline: true },
                    { name: '👨‍🍳 Chef', value: `<@${ticket.chefId}>`, inline: true },
                    { name: '🛍️ Customer', value: `<@${ticket.userId}>`, inline: true },
                    { name: '⏰ Completed', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setFooter({ text: 'Thank you for your order! This channel will be deleted in 30 seconds.' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
            // Get updated chef debt info
            const chefData = await db.getChefDebt(ticket.chefId);
            
            // Send debt update to chef
            const debtEmbed = new EmbedBuilder()
                .setTitle('💳 Debt Updated')
                .setDescription(`Your current debt: **$${chefData.debt_amount.toFixed(2)}**\nTotal orders completed: **${chefData.total_completed}**`)
                .setColor('#FFA500')
                .setTimestamp();
            
            try {
                const chef = await client.users.fetch(ticket.chefId);
                await chef.send({ embeds: [debtEmbed] });
            } catch (error) {
                console.log('Could not send DM to chef:', error.message);
            }
            
            // Check if chef should be set back to OPEN (remove this ticket from their load)
            const chefTickets = Array.from(client.activeTickets.values())
                .filter(t => t.chefId === ticket.chefId && !t.completed);
            
            if (chefTickets.length <= 1) { // 1 because current ticket isn't removed yet
                await db.updateChefStatus(ticket.chefId, 'OPEN');
                await client.utils.updateChefStatusEmbed();
            }
            
            // Delete the channel after 30 seconds
            setTimeout(async () => {
                try {
                    client.activeTickets.delete(channelId);
                    await interaction.channel.delete();
                } catch (error) {
                    console.error('Error deleting channel:', error);
                }
            }, 30000);
            
        } catch (error) {
            console.error('Error completing order:', error);
            await interaction.reply({ 
                content: 'There was an error completing the order!', 
                ephemeral: true 
            });
        }
    },
};