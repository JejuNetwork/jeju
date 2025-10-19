import { describe, it, expect } from 'bun:test';
import { autocoderPlugin } from '../index';

describe('Autocoder Plugin Configuration', () => {
  it('should have correct plugin structure', () => {
    expect(autocoderPlugin).toBeDefined();
    expect(autocoderPlugin.name).toBe('@elizaos/plugin-autocoder');
    expect(autocoderPlugin.description).toContain('code generation');
  });

  it('should export all required components', () => {
    // Check actions
    expect(autocoderPlugin.actions).toBeDefined();
    expect(autocoderPlugin.actions).toBeInstanceOf(Array);

    const actionNames = autocoderPlugin.actions.map((a) => a.name);
    console.log('Exported actions:', actionNames);

    expect(actionNames).toContain('GENERATE_CODE');
    expect(actionNames).toContain('CREATE_PROJECT');
    expect(actionNames.length).toBe(2);
  });

  it('should export providers', () => {
    expect(autocoderPlugin.providers).toBeDefined();
    expect(autocoderPlugin.providers).toBeInstanceOf(Array);

    const providerNames = autocoderPlugin.providers.map((p) => p.name);
    console.log('Exported providers:', providerNames);

    expect(providerNames).toContain('PROJECTS_CONTEXT');
    expect(providerNames).toContain('CURRENT_PROJECT_CONTEXT');
  });

  it('should export services', () => {
    expect(autocoderPlugin.services).toBeDefined();
    expect(autocoderPlugin.services).toBeInstanceOf(Array);

    const serviceNames = autocoderPlugin.services.map((s) => s.serviceName);
    console.log('Exported services:', serviceNames);

    expect(serviceNames).toContain('code-generation');
    expect(serviceNames).toContain('project-planning');
    expect(serviceNames).toContain('secrets-manager');
  });

  it('should have proper plugin dependencies', () => {
    expect(autocoderPlugin.dependencies).toBeDefined();
    expect(autocoderPlugin.dependencies).toBeInstanceOf(Array);

    console.log('Plugin dependencies:', autocoderPlugin.dependencies);

    // Should depend on forms plugin for interactive code generation
    expect(autocoderPlugin.dependencies).toContain('@elizaos/plugin-forms');

    // Should depend on plugin-manager for registry access
    expect(autocoderPlugin.dependencies).toContain('@elizaos/plugin-plugin-manager');
  });

  it('should validate action configurations', () => {
    const generateCodeAction = autocoderPlugin.actions.find((a) => a.name === 'GENERATE_CODE');
    expect(generateCodeAction).toBeDefined();
    expect(generateCodeAction!.description).toContain('code');
    expect(generateCodeAction!.validate).toBeDefined();
    expect(generateCodeAction!.handler).toBeDefined();

    // Check similes for better user experience
    expect(generateCodeAction!.similes).toContain('BUILD_CODE');
    expect(generateCodeAction!.similes).toContain('CREATE_CODE');
    expect(generateCodeAction!.similes).toContain('WRITE_CODE');
  });

  it('should have proper provider configuration', () => {
    const projectsProvider = autocoderPlugin.providers.find((p) => p.name === 'PROJECTS_CONTEXT');
    expect(projectsProvider).toBeDefined();
    expect(projectsProvider!.description).toContain('project');

    const currentProjectProvider = autocoderPlugin.providers.find(
      (p) => p.name === 'CURRENT_PROJECT_CONTEXT'
    );
    expect(currentProjectProvider).toBeDefined();
    expect(currentProjectProvider!.description).toContain('current project');
  });

  it('should have code generation service configured', () => {
    const codeGenService = autocoderPlugin.services.find(
      (s) => s.serviceName === 'code-generation'
    );
    expect(codeGenService).toBeDefined();
    expect(codeGenService!.serviceType).toBe('unknown'); // Using ServiceType.UNKNOWN
  });
});
