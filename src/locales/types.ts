// src/locales/types.ts

export type SupportedLocale = 'en' | 'zh';

export interface LocaleDefinition {
  name: string;
  code: SupportedLocale;

  Common: {
    cancel: string;
    save: string;
    create: string;
    update: string;
    delete: string;
    confirm: string;
    close: string;
    loading: string;
    saving: string;
    error: string;
    success: string;
    retry: string;
    reset: string;
    search: string;
    select: string;
    edit: string;
    view: string;
    back: string;
    next: string;
    done: string;
    enabled: string;
    disabled: string;
    active: string;
    inactive: string;
    yes: string;
    no: string;
    learnMore: string;
    default: string;
    custom: string;
    system: string;
    none: string;
    all: string;
    copy: string;
    copied: string;
    paste: string;
    clear: string;
    add: string;
    remove: string;
    import: string;
    export: string;
    open: string;
    download: string;
    upload: string;
    refresh: string;
    apply: string;
    discard: string;
  };

  Chat: {
    placeholder: string;
    placeholderWithContext: string;
    send: string;
    stop: string;
    regenerate: string;
    copy: string;
    copied: string;
    newChat: string;
    clearHistory: string;
    emptyState: {
      title: string;
      description: string;
      startChatting: string;
      systemPrompt: string;
      created: string;
    };
    voice: {
      startRecording: string;
      stopRecording: string;
      transcribing: string;
      notSupported: string;
      error: (message: string) => string;
    };
    image: {
      notSupported: string;
      notSupportedDescription: string;
      supportedModels: string;
      keepCurrentModel: string;
      chooseModel: string;
      noModelsAvailable: string;
      pasteSuccess: (filename: string) => string;
      pasteMultipleSuccess: (count: number) => string;
      dropHere: string;
    };
    files: {
      uploadImage: string;
      uploadFile: string;
      addAttachment: string;
      fileAdded: (filename: string) => string;
    };
    planMode: {
      label: string;
      enabledTooltip: string;
      disabledTooltip: string;
    };
    commands: {
      hint: string;
    };
    tools: {
      title: string;
      description: string;
      learnMore: string;
      selected: (count: number) => string;
      noTools: string;
      builtIn: string;
      modified: string;
      reset: string;
      resetSuccess: string;
      addedTemp: string;
      removedTemp: string;
    };
    model: {
      switchSuccess: string;
      switchFailed: string;
    };
  };

  Settings: {
    title: string;
    description: string;
    tabs: {
      account: string;
      apiKeys: string;
      models: string;
      shortcuts: string;
      about: string;
      language: string;
    };
    account: {
      title: string;
      description: string;
      profile: string;
      editProfile: string;
      displayName: string;
      profileUpdated: string;
      profileUpdateFailed: string;
      invalidFileType: string;
      fileTooLarge: string;
      signOut: string;
      signInDescription: string;
      signInWithGitHub: string;
      authRequired: string;
      failedUploadAvatar: string;
      invalidJsonResponse: string;
    };
    profile: {
      editTitle: string;
      editDescription: string;
      avatarUrl: string;
      avatarUrlPlaceholder: string;
      or: string;
      uploadImage: string;
      chooseFile: string;
      fileTypeHint: string;
      displayName: string;
      displayNamePlaceholder: string;
      displayNameHint: string;
      saveChanges: string;
    };
    apiKeys: {
      title: string;
      description: string;
      configured: string;
      notConfigured: string;
      enterKey: (provider: string) => string;
      testConnection: string;
      testing: string;
      testSuccess: (provider: string) => string;
      testFailed: (provider: string) => string;
      customBaseUrl: string;
      useCodingPlan: string;
      loadFailed: string;
      codingPlanEnabled: (provider: string) => string;
      codingPlanDisabled: (provider: string) => string;
      codingPlanUpdateFailed: (provider: string) => string;
      tooltipTitle: string;
      tooltipDescription: string;
      viewDocumentation: string;
      baseUrlPlaceholder: (url: string) => string;
    };
    models: {
      title: string;
      description: string;
      mainModel: {
        title: string;
        description: string;
      };
      smallModel: {
        title: string;
        description: string;
      };
      imageGenerator: {
        title: string;
        description: string;
      };
      transcription: {
        title: string;
        description: string;
      };
      resetToDefault: string;
      updated: (type: string) => string;
      providerUpdated: (type: string) => string;
      updateFailed: (type: string) => string;
      selectModel: string;
      customModels: {
        title: string;
        description: string;
        addModel: string;
        noModels: string;
        model: string;
        provider: string;
        selectProvider: string;
      };
    };
    customModelsDialog: {
      title: string;
      description: string;
      provider: string;
      selectProvider: string;
      fetchModels: string;
      availableModels: (count: number) => string;
      selectAll: string;
      clear: string;
      modelsSelected: (count: number) => string;
      manualModelName: string;
      manualModelPlaceholder: string;
      noListingSupport: string;
      enterManually: string;
      hideManualInput: string;
      addModelManually: string;
      noModelsFound: string;
      fetchFailed: (error: string) => string;
      selectAtLeastOne: string;
      addedModels: (count: number) => string;
      addFailed: string;
      addModels: string;
    };
    language: {
      title: string;
      description: string;
      selectLanguage: string;
      autoDetect: string;
    };
    shortcuts: {
      title: string;
      description: string;
      resetToDefault: string;
      clearShortcut: string;
      resetSuccess: string;
      globalFileSearch: string;
      globalContentSearch: string;
      fileSearch: string;
      saveFile: string;
      openModelSettings: string;
      newWindow: string;
      toggleTerminal: string;
      nextTerminalTab: string;
      previousTerminalTab: string;
      newTerminalTab: string;
      resetAllToDefaults: string;
      saveSettings: string;
      discardChanges: string;
      saved: string;
      saveFailed: string;
      resetFailed: string;
      unsavedChanges: string;
      usageTitle: string;
      usageClickInput: string;
      usageModifiers: string;
      usagePlatform: string;
      usageResetButton: string;
    };
    about: {
      title: string;
      description: string;
      version: string;
      checkForUpdates: string;
      checkingForUpdates: string;
      upToDate: string;
      updateAvailable: (version: string) => string;
      downloadUpdate: string;
      releaseNotes: string;
      license: string;
      github: string;
      documentation: string;
      reportIssue: string;
      platform: string;
      macos: string;
      softwareUpdates: string;
      softwareUpdatesDescription: string;
      lastChecked: string;
      resources: string;
      githubRepository: string;
      website: string;
    };
  };

  Agents: {
    title: string;
    createNew: string;
    edit: string;
    editTitle: string;
    createTitle: string;
    editDescription: string;
    createDescription: string;
    form: {
      name: string;
      nameRequired: string;
      namePlaceholder: string;
      description: string;
      descriptionPlaceholder: string;
      systemPrompt: string;
      systemPromptRequired: string;
      systemPromptPlaceholder: string;
      systemPromptHint: string;
      rules: string;
      rulesPlaceholder: string;
      outputFormat: string;
      outputFormatPlaceholder: string;
      modelType: string;
      modelTypeHint: string;
    };
    tabs: {
      basic: string;
      prompt: string;
      dynamic: string;
    };
    tools: {
      available: string;
    };
    saved: string;
    updated: string;
    created: string;
    saveFailed: string;
    deleteFailed: string;
    page: {
      description: string;
      marketplaceDescription: string;
      addAgent: string;
      refresh: string;
      searchPlaceholder: string;
      allCategories: string;
      sortPopular: string;
      sortRecent: string;
      sortDownloads: string;
      sortInstalls: string;
      sortName: string;
      localAgents: string;
      remoteAgents: string;
      loading: string;
      noAgentsFound: string;
      adjustFilters: string;
      loadingYourAgents: string;
      noAgentsYet: string;
      createFirstAgent: string;
      noAgentsMatch: string;
      adjustSearch: string;
      deleteTitle: string;
      deleteDescription: string;
      deleted: string;
      forked: string;
      forkFailed: string;
      forkError: string;
      notFound: string;
      loadDetailsFailed: string;
      toggleSuccess: (action: string) => string;
      updateFailed: string;
      published: string;
      tooltipTitle: string;
      tooltipDescription: string;
    };
  };

  Projects: {
    title: string;
    createNew: string;
    createTitle: string;
    createDescription: string;
    form: {
      name: string;
      nameRequired: string;
      namePlaceholder: string;
      description: string;
      descriptionPlaceholder: string;
      descriptionHint: string;
      context: string;
      contextPlaceholder: string;
      contextHint: string;
      rules: string;
      rulesPlaceholder: string;
      rulesHint: string;
    };
    created: (name: string) => string;
    createFailed: string;
    recentProjects: string;
    noRepository: string;
    opening: string;
    openFailed: (path: string) => string;
    page: {
      loading: string;
      description: string;
      importRepository: string;
      emptyTitle: string;
      emptyDescription: string;
      openInNewWindow: string;
      noRepositoryPath: string;
      openedInNewWindow: (name: string) => string;
      failedToOpenInWindow: string;
    };
  };

  Repository: {
    import: string;
    selectRepository: string;
    importing: string;
    emptyState: {
      title: string;
      description: string;
    };
    openFailed: (path: string) => string;
  };

  Skills: {
    title: string;
    system: string;
    custom: string;
    active: string;
    shared: string;
    viewDetails: string;
    activate: string;
    deactivate: string;
    edit: string;
    delete: string;
    fork: string;
    share: string;
    prompt: string;
    workflow: string;
    docs: (count: number) => string;
    scripts: string;
    marketplace: string;
    page: {
      description: string;
      createNew: string;
      refresh: string;
      searchPlaceholder: string;
      allCategories: string;
      sortName: string;
      sortDownloads: string;
      sortRating: string;
      sortRecent: string;
      sortUpdated: string;
      localSkills: string;
      remoteSkills: string;
      refreshed: string;
      deleted: string;
      deleteFailed: string;
      installed: (name: string) => string;
      installFailed: (error: string) => string;
      noSkillsYet: string;
      noSkillsFound: string;
      loading: string;
      loadFailed: string;
      deleteTitle: string;
      deleteDescription: (name: string) => string;
      tooltipTitle: string;
      tooltipDescription: string;
    };
  };

  Navigation: {
    explorer: string;
    explorerTooltip: string;
    chat: string;
    chatTooltip: string;
    projects: string;
    projectsTooltip: string;
    agents: string;
    agentsTooltip: string;
    skills: string;
    skillsTooltip: string;
    mcpServers: string;
    mcpServersTooltip: string;
    settings: string;
    settingsTooltip: string;
    switchTheme: (theme: 'light' | 'dark') => string;
  };

  Initialization: {
    title: string;
    description: string;
    failed: string;
    reload: string;
  };

  Error: {
    generic: string;
    network: string;
    unauthorized: string;
    notFound: string;
    loadFailed: (item: string) => string;
    saveFailed: (item: string) => string;
    deleteFailed: (item: string) => string;
    updateFailed: (item: string) => string;
  };

  Toast: {
    success: {
      saved: string;
      deleted: string;
      updated: string;
      copied: string;
      created: string;
    };
    error: {
      generic: string;
      tryAgain: string;
    };
  };

  MCPServers: {
    title: string;
    description: string;
    refreshAll: string;
    addServer: string;
    builtIn: string;
    connected: (count: number) => string;
    disconnected: string;
    refreshConnection: string;
    enableServer: string;
    disableServer: string;
    editServer: string;
    availableTools: string;
    noServers: string;
    noServersDescription: string;
    addDialogTitle: string;
    editDialogTitle: string;
    deleteDialogTitle: string;
    deleteDialogDescription: (name: string) => string;
    form: {
      serverId: string;
      serverIdPlaceholder: string;
      name: string;
      namePlaceholder: string;
      protocol: string;
      url: string;
      urlPlaceholder: string;
      apiKey: string;
      apiKeyPlaceholder: string;
      headers: string;
      headersPlaceholder: string;
      command: string;
      commandPlaceholder: string;
      arguments: string;
      argumentsPlaceholder: string;
    };
    validation: {
      serverIdRequired: string;
      nameRequired: string;
      commandRequired: string;
      urlRequired: string;
      invalidUrl: string;
      invalidHeaders: string;
      invalidArguments: string;
      argumentsMustBeArray: string;
    };
    actions: {
      creating: string;
      create: string;
      updating: string;
      update: string;
    };
    github: {
      setupRequired: string;
      setupDescription: string;
      step1: string;
      step2: string;
      step3: string;
      step4: string;
      connectionFailed: string;
      checkScopes: string;
      checkExpiry: string;
      checkNetwork: string;
      checkAPI: string;
    };
    tooltipTitle: string;
    tooltipDescription: string;
  };

  Providers: {
    aiGateway: { description: string };
    openRouter: { description: string };
    openai: { description: string };
    zhipu: { description: string };
    MiniMax: { description: string };
    google: { description: string };
    anthropic: { description: string };
    ollama: { description: string };
    lmstudio: { description: string };
    tavily: { description: string };
    elevenlabs: { description: string };
  };
}

export type LocaleMap = {
  [key in SupportedLocale]: LocaleDefinition;
};
