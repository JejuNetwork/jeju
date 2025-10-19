describe('Plugin Goals Working Tests', () => {
  const testAgentId = 'b438180f-bcb4-0e28-8cb1-ec0264051e59';

  it('should load the goals test page successfully', () => {
    cy.visit('/');
    cy.get('body').should('exist');
    cy.get('h1').should('contain', 'Plugin Goals Test Server');
  });

  it('should test goal creation interactions', () => {
    cy.visit('/');
    cy.get('#create-goal').should('be.visible');
    cy.get('#create-goal').click();
    cy.get('#goals-list').should('contain', 'Goal created successfully!');
  });

  it('should test API health endpoint', () => {
    cy.request('/api/health').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('status', 'ok');
      expect(response.body).to.have.property('service', 'plugin-goals-test');
    });
  });

  it('should test goals endpoint', () => {
    cy.request(`/api/goals?agentId=${testAgentId}`).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('success', true);
      expect(response.body.data).to.have.property('goals');
      expect(response.body.data.goals).to.have.length(2);
      expect(response.body.data.goals[0]).to.have.property('title', 'Complete project');
      expect(response.body.data.goals[1]).to.have.property('status', 'completed');
    });
  });

  it('should handle 404 errors gracefully', () => {
    cy.request({
      url: '/nonexistent',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(404);
    });
  });
});
