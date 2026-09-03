/**
 * MAP NOTES - TEAMS & UNANIMOUS VOTING SYSTEM
 * Every member must vote to delete a team before deletion occurs ("2/5 agreed").
 */

class TeamsManager {
  constructor() {
    this.teams = [];
  }

  async loadTeams() {
    try {
      const res = await window.api.getTeams();
      this.teams = res.teams || [];
      this.renderTeamsModal();
    } catch (err) {
      console.error('[TeamsManager] Error loading teams:', err);
    }
  }

  renderTeamsModal() {
    const listEl = document.getElementById('teamsList');
    if (!listEl) return;

    const currentUserId = window.api.currentUser ? window.api.currentUser.id : null;
    const activeTeamId = window.api.activeTeamId;

    listEl.innerHTML = '';

    this.teams.forEach(t => {
      const isActive = t.id === activeTeamId;
      const hasVoted = t.deleteVotes && t.deleteVotes.includes(currentUserId);
      const isMember = t.members.some(m => m.id === currentUserId);

      const teamCard = document.createElement('div');
      teamCard.className = `team-item-card ${isActive ? 'active-team' : ''}`;

      let membersHtml = t.members.map(m => `
        <div class="user-avatar-mini" style="background-color: ${m.avatar_color};" title="${m.name}">
          ${m.avatar_initials}
        </div>
      `).join('');

      teamCard.innerHTML = `
        <div class="team-header-row">
          <div>
            <h4 class="team-name">${t.name} ${isActive ? '<span class="badge-active">Active</span>' : ''}</h4>
            <span class="team-member-count">${t.members.length} sales rep${t.members.length === 1 ? '' : 's'}</span>
          </div>
          ${!isActive ? `<button class="btn-sm btn-outline switch-team-btn" data-team-id="${t.id}">Switch</button>` : ''}
        </div>

        <div class="team-members-avatars-row">
          ${membersHtml}
        </div>

        <div class="team-vote-section">
          <div class="vote-progress-bar-wrap">
            <div class="vote-label-row">
              <span style="font-size: 11px; font-weight: 600; color: #64748B;">Unanimous Deletion Consensus</span>
              <span class="vote-progress-text">${t.voteCount}/${t.memberCount} Agreed</span>
            </div>
            <div class="vote-track">
              <div class="vote-fill" style="width: ${t.memberCount > 0 ? (t.voteCount / t.memberCount) * 100 : 0}%;"></div>
            </div>
          </div>

          ${isMember ? `
            <button class="btn-sm ${hasVoted ? 'btn-danger' : 'btn-outline-danger'} vote-delete-btn" data-team-id="${t.id}">
              ${hasVoted ? `✓ You Voted (${t.voteCount}/${t.memberCount})` : `Vote to Delete (${t.voteCount}/${t.memberCount} agreed)`}
            </button>
          ` : `<span style="font-size: 11px; color: #94A3B8;">Not a member of this team</span>`}
        </div>
      `;

      // Event: Switch Active Team
      const switchBtn = teamCard.querySelector('.switch-team-btn');
      if (switchBtn) {
        switchBtn.addEventListener('click', () => {
          window.api.activeTeamId = t.id;
          localStorage.setItem('mapnotes_team_id', t.id);
          this.renderTeamsModal();
          if (window.mapNotesApp) {
            window.mapNotesApp.reloadPlaces();
          }
        });
      }

      // Event: Vote to Delete Team
      const voteBtn = teamCard.querySelector('.vote-delete-btn');
      if (voteBtn) {
        voteBtn.addEventListener('click', async () => {
          try {
            const res = await window.api.voteDeleteTeam(t.id);
            if (res.deleted) {
              alert(res.message || 'Team deleted by unanimous vote.');
              // Reset to default team if active was deleted
              if (window.api.activeTeamId === t.id) {
                window.api.activeTeamId = 'default-team';
                localStorage.setItem('mapnotes_team_id', 'default-team');
              }
            }
            await this.loadTeams();
            if (window.mapNotesApp) {
              window.mapNotesApp.reloadPlaces();
            }
          } catch (err) {
            alert('Failed to vote: ' + err.message);
          }
        });
      }

      listEl.appendChild(teamCard);
    });
  }
}

window.teamsManager = new TeamsManager();
