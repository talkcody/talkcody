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
      modal: {
        connectingTitle: string;
        transcribingTitle: string;
        recordingTitle: string;
        connecting: string;
        recording: string;
        processing: string;
        liveTranscript: string;
        stopAndTranscribe: string;
      };
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
    modelSelector: {
      title: string;
      description: string;
      currentModel: string;
      noModels: string;
    };
    toolbar: {
      model: string;
      planMode: string;
      actMode: string;
      planModeTooltip: string;
      actModeTooltip: string;
      toggleTerminal: string;
      searchFiles: string;
      searchContent: string;
      inputTokens: string;
      outputTokens: string;
    };
    chatHistory: string;
    searchConversations: string;
  };

  Settings: {
    title: string;
    description: string;
    tabs: {
      account: string;
      apiKeys: string;
      customProviders: string;
      models: string;
      shortcuts: string;
      general: string;
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
      messageCompaction: {
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
      searchPlaceholder: string;
      clearSearchAria: string;
      noModelsMatch: (query: string) => string;
      searchResults: (count: number) => string;
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
    theme: {
      title: string;
      description: string;
      options: {
        light: string;
        dark: string;
        system: string;
      };
      currentTheme: string;
      switchTo: string;
    };
    general: {
      title: string;
      description: string;
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
    search: {
      searchFiles: string;
      searchFilesPlaceholder: string;
      searchContentPlaceholder: string;
      searching: string;
      searchingFiles: string;
      noFilesFound: string;
      noFilesFoundDescription: string;
      noMatchesFound: string;
      tryDifferentTerm: string;
      typeToSearch: string;
      typeToSearchFiles: string;
      typeToSearchContent: string;
      filesFound: string;
      matchesInFiles: (matches: number, files: number) => string;
      navigate: string;
      openFile: string;
      cancel: string;
      useArrowsToNavigate: string;
      useSpacesForMultipleKeywords: string;
      lookingFor: string;
      noFilesContainAllKeywords: string;
      matchingAll: string;
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
    terminal: {
      title: string;
      description: string;
      defaultShell: string;
      shellHint: string;
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
      deleteProject: string;
      deleteProjectTitle: string;
      deleteProjectDescription: (name: string) => string;
      deleteProjectCancel: string;
      deleteProjectConfirm: string;
      deleteProjectDeleting: string;
      deleteProjectSuccess: (name: string) => string;
      deleteProjectError: string;
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
    directoryNotFound: string;
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
    selector: {
      title: string;
      description: string;
      learnMore: string;
      active: string;
      searchPlaceholder: string;
      loading: string;
      noSkillsFound: string;
      noSkillsAvailable: string;
      browseMarketplace: string;
      skillRemoved: string;
      skillAdded: string;
      updateFailed: string;
    };
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
    logs: string;
    logsTooltip: string;
    settings: string;
    settingsTooltip: string;
    switchTheme: (theme: 'light' | 'dark') => string;
    githubTooltip: string;
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

  Logs: {
    title: string;
    description: string;
    openLogDirectory: string;
    refresh: string;
    logDirectory: string;
    logDirectoryDescription: string;
    latestEntries: string;
    latestEntriesDescription: string;
    noLogsFound: string;
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
    selector: {
      title: string;
      description: string;
      learnMore: string;
      toolsTitle: string;
      modified: string;
      selected: string;
      reset: string;
      noServersAvailable: string;
      connected: string;
      error: string;
      noToolsFromServer: string;
      noActiveAgent: string;
      toolRemoved: string;
      toolAdded: string;
      updateFailed: string;
      overridesReset: string;
      resetFailed: string;
    };
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
      envVars: string;
      envVarsPlaceholder: string;
      envVarKey: string;
      envVarValue: string;
      addEnvVar: string;
      minimaxApiKey: string;
      minimaxApiKeyPlaceholder: string;
      minimaxApiHost: string;
      glmApiKey: string;
      glmApiKeyPlaceholder: string;
      glmApiMode: string;
      glmApiModeHint: string;
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
      invalidEnvVars: string;
      duplicateEnvVarKey: string;
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

  Onboarding: {
    title: string;
    subtitle: string;
    skip: string;
    getStarted: string;
    steps: {
      language: {
        title: string;
        description: string;
      };
      theme: {
        title: string;
        description: string;
        light: string;
        dark: string;
        system: string;
      };
    };
  };

  LLMService: {
    status: {
      initializing: string;
      step: (iteration: number) => string;
      compacting: string;
      compressed: (ratio: string) => string;
      compressionFailed: string;
    };
    errors: {
      noProvider: (model: string, provider: string) => string;
      streamResultNull: string;
      unknownFinishReason: string;
    };
  };

  VoiceInput: {
    success: {
      transcriptionCompleted: string;
      realtimeStarted: string;
      recordingStarted: string;
      recordingCancelled: string;
    };
    errors: {
      apiKeyNotConfigured: string;
      transcriptionError: (message: string) => string;
      failedToStart: string;
      microphoneAccessDenied: string;
      noMicrophoneFound: string;
      microphoneInUse: string;
      serviceNotAvailable: string;
      stopFailed: (message: string) => string;
      recordingError: string;
      failedToStartRecording: string;
      noActiveRecording: string;
      noAudioData: string;
      emptyAudio: string;
      noTranscriptionText: string;
      transcriptionFailed: (message: string) => string;
    };
  };

  Auth: {
    success: {
      signedIn: string;
      signedOut: string;
    };
    errors: {
      failedToInitiate: (message: string) => string;
      signOutFailed: (message: string) => string;
      completionFailed: string;
      completionFailedWithMessage: (message: string) => string;
    };
  };

  RepositoryStore: {
    success: {
      repositoryOpened: string;
      fileSaved: (name: string) => string;
      fileRefreshed: string;
    };
    errors: {
      failedToLoadDirectory: string;
      failedToOpen: (message: string) => string;
      failedToRead: (message: string) => string;
      failedToSave: (message: string) => string;
      searchFailed: string;
      failedToRefresh: (message: string) => string;
      failedToRefreshTree: (message: string) => string;
    };
  };

  FileTree: {
    success: {
      renamed: (name: string) => string;
      deleted: (name: string) => string;
      pathCopied: string;
      relativePathCopied: string;
      cutToClipboard: (name: string) => string;
      copiedToClipboard: (name: string) => string;
      moved: (name: string) => string;
      copied: (name: string) => string;
      itemCreated: (type: string) => string;
      refreshed: string;
    };
    errors: {
      failedToLoadDirectory: string;
      nothingToPaste: string;
      pasteFailed: (message: string) => string;
      deleteFailed: (name: string, message: string) => string;
      repositoryPathNotAvailable: string;
    };
    contextMenu: {
      newFile: string;
      newFolder: string;
      cut: string;
      copy: string;
      paste: string;
      rename: string;
      delete: string;
      deleting: string;
      copyPath: string;
      copyRelativePath: string;
      refresh: string;
    };
    placeholder: {
      folderName: string;
      fileName: string;
    };
    states: {
      loading: string;
    };
  };

  ApiClient: {
    errors: {
      authenticationRequired: string;
      sessionExpired: string;
    };
  };

  FileDiffPreview: {
    editTitle: string;
    writeTitle: string;
    changes: string;
    feedbackTitle: string;
    feedbackPlaceholder: string;
    reviewPrompt: string;
    submitFeedback: string;
    allowAllEdits: string;
    approveAndApply: string;
  };

  MCPServersExtra: {
    alerts: {
      cannotDeleteBuiltIn: string;
      operationFailed: (message: string) => string;
    };
    github: {
      setupRequired: string;
      setupInstructions: {
        intro: string;
        step1: string;
        step2: string;
        step3: string;
        step4: string;
      };
      connectionFailed: {
        title: string;
        checkScopes: string;
        checkExpiry: string;
        checkNetwork: string;
        checkApi: string;
      };
    };
    tooltip: {
      deleteServer: string;
    };
  };

  StreamProcessor: {
    status: {
      answering: string;
      thinking: string;
      callingTool: (toolName: string) => string;
    };
  };

  PlanReview: {
    submitted: string;
    title: string;
    description: string;
    editHint: string;
    editPlaceholder: string;
    feedbackPrompt: string;
    feedbackPlaceholder: string;
    cancel: string;
    submitRejection: string;
    edit: string;
    preview: string;
    rejectAndFeedback: string;
    approve: string;
  };

  AskUserQuestions: {
    submitted: string;
    title: string;
    description: string;
    selectMultiple: string;
    selectOne: string;
    otherLabel: string;
    otherPlaceholder: string;
    submitAnswers: string;
  };

  CustomProviderDialog: {
    addTitle: string;
    editTitle: string;
    description: string;
    providerType: string;
    selectProviderType: string;
    providerName: string;
    providerNamePlaceholder: string;
    baseUrl: string;
    baseUrlPlaceholder: string;
    baseUrlHint: string;
    apiKey: string;
    apiKeyPlaceholder: string;
    enabled: string;
    test: string;
    testing: string;
    saving: string;
    skip: string;
    connectionSuccessful: string;
    connectionSuccessfulWithTime: (time: number) => string;
    connectionFailed: (error: string) => string;
    availableModelsHint: (models: string, more: number) => string;
    fixValidationErrors: string;
    testFailed: (error: string) => string;
    providerUpdated: string;
    providerAdded: string;
    saveFailed: (error: string) => string;
    addModelsTitle: (name: string) => string;
    openaiCompatible: string;
    openaiCompatibleDescription: string;
    anthropic: string;
    anthropicDescription: string;
  };

  CustomProviderSection: {
    description: string;
    noProviders: string;
    providerEnabled: string;
    providerDisabled: string;
    updateFailed: string;
    deleteConfirm: (name: string) => string;
    deleteFailed: string;
    deleteSuccess: string;
  };

  WhatsNew: {
    title: string;
    viewFullChangelog: string;
    gotIt: string;
    added: string;
    changed: string;
    fixed: string;
    removed: string;
    releasedOn: (date: string) => string;
  };

  Lint: {
    // Panel
    problems: string;
    noProblems: string;
    lintDisabled: string;
    autoFixAll: string;

    // Severity
    error: string;
    warning: string;
    info: string;
    showErrors: string;
    showWarnings: string;
    showInfo: string;

    // Diagnostic
    lineColumn: (line: number, column: number) => string;
    quickFix: string;
    fix: string;
    viewInEditor: string;

    // Quick fix options
    fixes: {
      removeVariable: string;
      removeVariableDesc: string;
      removeImports: string;
      removeImportsDesc: string;
      convertToConst: string;
      convertToConstDesc: string;
      addTypeAnnotation: string;
      addTypeAnnotationDesc: string;
      addComment: string;
      addCommentDesc: string;
      ignoreDiagnostic: string;
      ignoreDiagnosticDesc: string;
      cancel: string;
    };

    // Messages
    fixApplied: string;
    fixFailed: (error: string) => string;
    autoFixComingSoon: string;
    autoFixFailed: string;
    unknownError: string;

    // Settings
    settings: {
      title: string;
      description: string;
      resetToDefaults: string;
      currentStatus: string;
      viewStatistics: string;
      enableLint: string;
      enableLintDesc: string;
      supportedLanguages: string;
      enableBiome: string;
      enableBiomeDesc: string;
      severitySettings: string;
      severitySettingsDesc: string;
      showErrorsDesc: string;
      showWarningsDesc: string;
      showInfoDesc: string;
      displaySettings: string;
      showInEditor: string;
      showInEditorDesc: string;
      showProblemsPanel: string;
      showProblemsPanelDesc: string;
      performanceSettings: string;
      checkDelay: string;
      checkDelayDesc: string;
      quickFixSettings: string;
      enableQuickFix: string;
      enableQuickFixDesc: string;
      runtimeWarning: string;
      runtimeWarningDesc: string;
      downloadNode: string;
      downloadBun: string;
    };

    // Diagnostic codes descriptions
    diagnosticCodes: {
      'no-unused-variables': string;
      'no-unused-imports': string;
      'use-const': string;
      'prefer-const': string;
      'no-explicit-any': string;
      'no-empty-function': string;
      'no-console': string;
      'no-debugger': string;
      'no-alert': string;
      eqeqeq: string;
      curly: string;
      'no-unused-expressions': string;
      'prefer-arrow-callback': string;
      'no-var': string;
    };

    // Editor header
    checking: string;
    noIssues: string;

    // File editor header status
    autoSaving: string;
    saving: string;
    aiAnalyzing: string;
    aiSuggestion: string;
    savedAt: (time: string) => string;
    codeNavigationEnabled: string;
    notIndexedYet: string;
    indexed: string;
    notIndexed: string;

    // FixApplier
    FixApplier: {
      editorNotReady: string;
      editorModelNotReady: string;
      unknownFixType: (fixId: string) => string;
    };
  };
}

export type LocaleMap = {
  [key in SupportedLocale]: LocaleDefinition;
};
