const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removechef')
        .setDescription('Remove a chef from the system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('chef')
                .setDescription('The chef to remove')
                .setRequired(true)),
    
    async execute(interaction, client, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const targetUser = interaction.options.getUser('chef');
            
            // Check if user is actually a chef
            const chef = await db.getChef(targetUser.id);
            
            if (!chef) {
                return interaction.editReply({ 
                    content: `❌ <@${targetUser.id}> is not registered as a chef!` 
                });
            }

            // Check if chef has active tickets
            const activeTickets = Array.from(client.activeTickets.values())
                .filter(ticket => ticket.chefId === targetUser.id && !ticket.completed);
            
            if (activeTickets.length > 0) {
                return interaction.editReply({ 
                    content: `❌ Cannot remove <@${targetUser.id}>! They currently have **${activeTickets.length}** active ticket(s). Please complete or reassign these orders first.` 
                });
            }

            // Get chef's debt information before removing
            const debts = await db.getDebts(targetUser.id);
            const totalOwed = debts.reduce((sum, debt) => sum + debt.amount, 0);

            // Remove chef from database
            await db.deleteChef(targetUser.id);

            // Remove chef role from user
            try {
                const guild = interaction.guild;
                const member = await guild.members.fetch(targetUser.id);
                const chefRole = guild.roles.cache.get(process.env.CHEF_ROLE_ID);
                
                if (chefRole && member.roles.cache.has(chefRole.id)) {
                    await member.roles.remove(chefRole);
                }
            } catch (error) {
                console.log('Could not remove chef role:', error.message);
            }

            // Update chef status embed
            await client.utils.updateChefStatusEmbed();

            // Send confirmation embed
            const embed = new EmbedBuilder()
                .setTitle('👨‍🍳 Chef Removed')
                .setDescription(`Successfully removed <@${targetUser.id}> from the chef system`)
                .setColor('#FF6B35')
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: '👤 Chef', value: `<@${targetUser.id}>`, inline: true },
                    { name: '💰 Total Debt Owed', value: `$${totalOwed.toFixed(2)}`, inline: true },
                    { name: '📊 Total Orders', value: `${debts.length}`, inline: true }
                )
                .setFooter({ text: 'Chef has been removed from the system' })
                .setTimestamp();

            if (totalOwed > 0) {
                embed.addFields({
                    name: '⚠️ Note',
                    value: `This chef still owes **$${totalOwed.toFixed(2)}** in debt. Their debt history has been preserved.`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error removing chef:', error);
            await interaction.editReply({ 
                content: '❌ An error occurred while removing the chef. Check console for details.',
                embeds: []
            });
        }
    },
};
