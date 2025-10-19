describe('Plugin Todo Working Tests', () => {
  it('should load the test page successfully', () => {
    cy.visit('/');
    cy.get('body').should('exist');
    cy.get('h1').should('contain', 'Plugin Todo Test Server');
  });

  it('should test basic interactions', () => {
    cy.visit('/');
    cy.get('#test-button').should('be.visible');
    cy.get('#test-button').click();
    cy.get('#result').should('contain', 'Button clicked!');
  });

  it('should test API endpoints', () => {
    cy.request('/health').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('status', 'ok');
      expect(response.body).to.have.property('service', 'plugin-todo-test');
    });
  });

  it('should test todos API', () => {
    cy.request('/api/todos').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('success', true);
      expect(response.body.data).to.have.property('todos');
      expect(response.body.data.todos).to.have.length(2);
      expect(response.body.data.todos[0]).to.have.property('title', 'Test Todo 1');
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
