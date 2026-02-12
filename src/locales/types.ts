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
    video: {
      notSupported: string;
      notSupportedDescription: string;
      supportedModels: string;
      keepCurrentModel: string;
      chooseModel: string;
      noModelsAvailable: string;
      pasteSuccess: (filename: string) => string;
      pasteMultipleSuccess: (count: number) => string;
      dropHere: string;
      sizeExceeded: (size: string) => string;
      unsupportedFormat: (format: string) => string;
    };
    files: {
      uploadImage: string;
      uploadVideo: string;
      uploadFile: string;
      addAttachment: string;
      fileAdded: (filename: string) => string;
    };
    planMode: {
      label: string;
      title: string;
      description: string;
      learnMore: string;
      enabledTooltip: string;
      disabledTooltip: string;
    };
    ralphLoop: {
      label: string;
      title: string;
      description: string;
      learnMore: string;
      enabledTooltip: string;
      disabledTooltip: string;
    };
    worktree: {
      label: string;
      title: string;
      description: string;
      learnMore: string;
      enabledTooltip: string;
      disabledTooltip: string;
    };
    commands: {
      hint: string;
      unknownCommand: (name: string) => string;
      invalidCommand: string;
    };
    compaction: {
      dialogTitle: string;
      compacting: string;
      stats: {
        originalMessages: string;
        compactedMessages: string;
        reductionPercent: string;
        compressionRatio: string;
      };
      errors: {
        noTask: string;
        taskNotFound: string;
        noMessages: string;
        noChange: string;
        failed: (message: string) => string;
      };
      successMessage: (count: number, reduction: number) => string;
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
    autoApproveEdits: {
      title: string;
      description: string;
      enabled: string;
      disabled: string;
      enabledTooltip: string;
      disabledTooltip: string;
      toggleFailed: string;
    };
    autoApprovePlan: {
      title: string;
      description: string;
      enabled: string;
      disabled: string;
      enabledTooltip: string;
      disabledTooltip: string;
      toggleFailed: string;
    };
    autoCodeReview: {
      title: string;
      description: string;
      enabled: string;
      disabled: string;
      enabledTooltip: string;
      disabledTooltip: string;
      toggleFailed: string;
    };
    outputFormat: {
      title: string;
      description: string;
      currentFormat: string;
      switchSuccess: string;
      markdown: string;
      mermaid: string;
      web: string;
      ppt: string;
      markdownDescription: string;
      mermaidDescription: string;
      webDescription: string;
      pptDescription: string;
      viewSource: string;
      viewRendered: string;
    };
    reasoningEffort: {
      title: string;
      description: string;
      currentEffort: string;
      hint: string;
      success: string;
      failed: string;
    };
    promptEnhancement: {
      optionsButton: string;
      enhanceButton: string;
      enhancing: string;
      success: string;
      failed: string;
      emptyPrompt: string;
      contextExtraction: string;
      contextExtractionDescription: string;
      modelSelect: string;
      modelPlaceholder: string;
      followCurrentModel: string;
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
    searchTasks: string;
  };

  Settings: {
    title: string;
    description: string;
    tabs: {
      account: string;
      apiKeys: string;
      customProviders: string;
      models: string;
      terminal: string;
      lint: string;
      lsp: string;
      worktree: string;
      shortcuts: string;
      general: string;
      about: string;
      language: string;
      customTools: string;
      hooks: string;
      remoteControl: string;
    };
    hooksScopeHint: string;
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
      signInWithGoogle: string;
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
      useInternational: string;
      loadFailed: string;
      codingPlanEnabled: (provider: string) => string;
      codingPlanDisabled: (provider: string) => string;
      codingPlanUpdateFailed: (provider: string) => string;
      internationalEnabled: (provider: string) => string;
      internationalDisabled: (provider: string) => string;
      internationalUpdateFailed: (provider: string) => string;
      tooltipTitle: string;
      tooltipDescription: string;
      viewDocumentation: string;
      baseUrlPlaceholder: (url: string) => string;
    };
    claudeOAuth: {
      title: string;
      description: string;
      signIn: string;
      browserOpened: string;
      pasteCode: string;
      pasteCodeLabel: string;
      codePlaceholder: string;
      portInUse: string;
      portInUseTitle: string;
      connect: string;
      connected: string;
      connectedWithPlan: string;
      disconnect: string;
      disconnected: string;
      useApiKeyInstead: string;
      connectionFailed: string;
      connectionFailedWithPort: string;
      tokenRefreshFailed: string;
      disclaimer: {
        dialogTitle: string;
        dialogDescription: string;
        termsLink: string;
        confirmButton: string;
        cancelButton: string;
        checkboxLabel: string;
      };
    };
    openaiOAuth: {
      title: string;
      description: string;
      signIn: string;
      step1: string;
      step1Hint: string;
      step2: string;
      step2Hint: string;
      codePlaceholder: string;
      portInUse: string;
      portInUseTitle: string;
      connect: string;
      connected: string;
      connectedWithPlan: string;
      disconnect: string;
      disconnected: string;
      pasteCode: string;
      connectionFailed: string;
      connectionFailedWithPort: string;
      tokenRefreshFailed: string;
      redirectUriNote: string;
      redirectUriHint: string;
      disclaimer: {
        dialogTitle: string;
        dialogDescription: string;
        termsLink: string;
        confirmButton: string;
        cancelButton: string;
        checkboxLabel: string;
      };
    };
    githubCopilotOAuth: {
      title: string;
      description: string;
      signIn: string;
      step1: string;
      step1Hint: string;
      step2: string;
      step2Hint: string;
      userCode: string;
      codePlaceholder: string;
      connect: string;
      connected: string;
      connectedWithPlan: string;
      disconnect: string;
      disconnected: string;
      pasteCode: string;
      connectionFailed: string;
      tokenRefreshFailed: string;
      waitingForAuth: string;
      exchangingCode: string;
      exchangingCodeHint: string;
      disclaimer?: {
        dialogTitle: string;
        dialogDescription: string;
        termsLink: string;
        confirmButton: string;
        cancelButton: string;
        checkboxLabel: string;
      };
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
      planModel: {
        title: string;
        description: string;
      };
      codeReviewModel: {
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
    terminalFont: {
      title: string;
      description: string;
      fontFamily: string;
      fontSize: string;
      placeholder: string;
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
    remoteControl: {
      title: string;
      description: string;
      enabled: string;
      tokenLabel: string;
      tokenPlaceholder: string;
      allowedChatsLabel: string;
      allowedChatsPlaceholder: string;
      pollTimeoutLabel: string;
      pollTimeoutPlaceholder: string;
      pollTimeoutHint: string;
      keepAwakeLabel: string;
      keepAwakeHint: string;
      statusEnabled: string;
      statusDisabled: string;
      save: string;
      saved: string;
      saveFailed: string;
      errors: {
        tokenMissing: string;
        pollTimeoutRange: string;
      };
      feishu: {
        title: string;
        description: string;
        enabled: string;
        appIdLabel: string;
        appIdPlaceholder: string;
        appSecretLabel: string;
        appSecretPlaceholder: string;
        encryptKeyLabel: string;
        encryptKeyPlaceholder: string;
        verificationTokenLabel: string;
        verificationTokenPlaceholder: string;
        allowedOpenIdsLabel: string;
        allowedOpenIdsPlaceholder: string;
        allowlistHint: string;
        errors: {
          appIdMissing: string;
          appSecretMissing: string;
        };
      };
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
      recentFiles: string;
      noRecentFiles: string;
      recentFilesHint: string;
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
      tooltipTitle: string;
      tooltipDescription: string;
      defaultShell: string;
      shellHint: string;
    };
    worktree: {
      title: string;
      description: string;
      tooltipTitle: string;
      tooltipDescription: string;
      rootPath: string;
      selectDirectory: string;
      customPathHint: string;
      defaultPathHint: string;
      pathPreview: string;
    };
    customTools: {
      title: string;
      description: string;
      tooltipTitle: string;
      tooltipDescription: string;
      locationLabel: string;
      empty: string;
      selectDirectory: string;
      customDirectoryLabel: string;
      customDirectoryUnset: string;
      sourcesHint: string;
      workspaceDirectoryLabel: string;
      homeDirectoryLabel: string;
    };
    hooks: {
      title: string;
      description: string;
      tooltipTitle: string;
      tooltipDescription: string;
      enableLabel: string;
      enableDescription: string;
      warningTitle: string;
      warningBody: string;
      configTitle: string;
      configDescription: string;
      configEditorLabel: string;
      scope: {
        user: string;
        project: string;
        local: string;
      };
      save: string;
      saving: string;
      reload: string;
      loadFailed: string;
      saveSuccess: string;
      saveFailed: string;
      invalidJson: string;
      toggleFailed: string;
      enabledToast: string;
      disabledToast: string;
      blockedPrompt: string;
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
      importFromGitHub: string;
      tooltipTitle: string;
      tooltipDescription: string;
    };
    githubImport: {
      title: string;
      description: string;
      urlLabel: string;
      urlPlaceholder: string;
      urlHint: string;
      urlRequired: string;
      scanning: string;
      invalidUrl: string;
      networkError: string;
      imported: string;
      failed: string;
      import: string;
      close: string;
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

  RepositoryLayout: {
    maxConcurrentTasksReached: string;
    fullscreen: string;
    exitFullscreen: string;
    deleteTaskWithChangesTitle: string;
    deleteAnyway: string;
  };

  FileChanges: {
    codeReviewMessage: string;
    reviewTooltip: string;
    commitTooltip: string;
    mergeTooltip: string;
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
      importFromGitHub: string;
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
    metadata?: {
      label: string;
      empty: string;
      selectKey: string;
      valuePlaceholder: string;
    };
    references?: {
      title: string;
      addButton: string;
      empty: string;
      emptyHint: string;
      helpText: string;
      alreadyExists: string;
      invalidExtension: string;
      uploadSuccess: string;
      uploadError: string;
      deleteConfirm: string;
      deleteSuccess: string;
      preview: string;
      previewDescription: string;
      previewError: string;
      download: string;
      downloadStarted: string;
      downloadError: string;
    };
    assets?: {
      title: string;
      addButton: string;
      empty: string;
      emptyHint: string;
      helpText: string;
      alreadyExists: string;
      invalidExtension: string;
      uploadSuccess: string;
      uploadError: string;
      deleteConfirm: string;
      deleteSuccess: string;
      previewDescription: string;
      previewError: string;
      preview: string;
      download: string;
      downloadStarted: string;
      downloadError: string;
    };
    githubImport: {
      title: string;
      description: string;
      urlLabel: string;
      urlPlaceholder: string;
      urlHint: string;
      urlRequired: string;
      scanning: string;
      foundSkills: (count: number) => string;
      noSkillsFound: string;
      invalidUrl: string;
      networkError: string;
      importing: string;
      importSuccess: (count: number) => string;
      importFailed: (count: number) => string;
      imported: string;
      failed: string;
      alreadyExists: (name: string) => string;
      selectAll: string;
      deselectAll: string;
      scan: string;
      import: string;
      cancel: string;
      back: string;
      close: string;
      importMore: string;
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
    toolsPlayground: string;
    toolsPlaygroundTooltip: string;
    usage: string;
    usageTooltip: string;
    tracing: string;
    tracingTooltip: string;
    logs: string;
    logsTooltip: string;
    settings: string;
    settingsTooltip: string;
    switchTheme: (theme: 'light' | 'dark') => string;
    githubTooltip: string;
  };

  PptViewer: {
    slideOf: (current: number, total: number) => string;
    previous: string;
    next: string;
    exportPdf: string;
    keyboardShortcuts: string;
    empty: string;
  };

  Sidebar: {
    files: string;
    tasks: string;
    filesTab: string;
    tasksTab: string;
    toggleView: string;
    collapse: string;
    expand: string;
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

  Tracing: {
    title: string;
    description: string;
    listTitle: string;
    detailTitle: string;
    spansTitle: string;
    eventsTitle: string;
    attributesLabel: string;
    startedAtLabel: string;
    durationLabel: string;
    spanCountLabel: string;
    loadError: string;
    emptyDescription: string;
    selectTrace: string;
    noSpans: string;
    noEvents: string;
    toggleLabel: string;
    enabledLabel: string;
    disabledLabel: string;
    disabledTitle: string;
    disabledBody: string;
    disabledListHint: string;
    disabledTraceCountLabel: string;
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

  KeepAwake: {
    enabled: string;
    error: string;
    platformNotSupported: string;
  };

  MCPServers: {
    title: string;
    description: string;
    refreshAll: string;
    refreshAllTooltip: string;
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
      allToolsAlreadySelected: string;
      noToolsToClear: string;
      toolsSelected: (count: number) => string;
      toolsCleared: (count: number) => string;
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
      contextTooLongCompacting: string;
    };
    errors: {
      noProvider: (model: string, provider: string) => string;
      streamResultNull: string;
      unknownFinishReason: string;
      contextTooLongCompactionFailed: string;
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
      openaiOAuthNotSupported: string;
    };
  };

  Auth: {
    loginRequired: string;
    signIn: string;
    success: {
      signedIn: string;
      signedOut: string;
    };
    errors: {
      failedToInitiate: (message: string) => string;
      signOutFailed: (message: string) => string;
      completionFailed: string;
      completionFailedWithMessage: (message: string) => string;
      invalidCallback: string;
    };
  };

  TalkCodyFreeDialog: {
    title: string;
    description: string;
    signInWithGitHub: string;
    signInWithGoogle: string;
    useOwnApiKey: string;
    benefits: {
      preventAbuse: string;
      stableService: string;
    };
    manual: {
      title: string;
      description: string;
      placeholder: string;
      copyLink: string;
      copySuccess: string;
      copyFailed: string;
      submit: string;
      note: string;
    };
  };

  RepositoryStore: {
    success: {
      repositoryOpened: string;
      fileSaved: (name: string) => string;
      fileRefreshed: string;
      fileReloaded: (name: string) => string;
    };
    info: {
      fileUpdatedExternally: (name: string) => string;
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

  ExternalFileChange: {
    title: string;
    description: (fileName: string) => string;
    keepLocal: string;
    loadDisk: string;
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

  RemoteControl: {
    help: string;
    unknownCommand: string;
    processing: string;
    accepted: string;
    completed: string;
    failed: string;
    noActiveTask: string;
    noPendingApproval: string;
    approved: string;
    rejected: string;
    stopped: string;
    gatewayError: (message: string) => string;
    approvalPrompt: (filePath: string) => string;
    status: (status: string) => string;
    statusDetail: (input: {
      projectDisplay: string;
      model: string;
      agentId: string;
      planModeEnabled: boolean;
      taskStatus: string;
      setProjectHint: string;
    }) => string;
    setProjectHint: string;
    listUsage: string;
    listProjectsTitle: string;
    listModelsTitle: string;
    listAgentsTitle: string;
    listEmpty: string;
    listError: string;
    missingModelArg: string;
    invalidModel: (model: string) => string;
    modelSwitched: (model: string) => string;
    missingProjectArg: string;
    invalidProject: (projectId: string) => string;
    projectSwitched: (projectId: string) => string;
    missingAgentArg: string;
    invalidAgent: (agentId: string) => string;
    agentSwitched: (agentId: string) => string;
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
    notificationTitle: string;
    notificationBody: string;
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
    baseUrlPlaceholderOpenAI: string;
    baseUrlPlaceholderAnthropic: string;
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
    videoPreview: string;
    videoCaptionsLabel: string;
    releasedOn: (date: string) => string;
  };

  Worktree: {
    conflictDialog: {
      title: string;
      description: string;
      changesCount: (count: number) => string;
      modifiedFiles: string;
      addedFiles: string;
      deletedFiles: string;
      worktreePath: string;
      actions: {
        discard: string;
        discardDescription: string;
        merge: string;
        mergeDescription: string;
        sync: string;
        syncDescription: string;
        cancel: string;
      };
      mergeConflict: {
        title: string;
        description: string;
        conflictFiles: string;
        resolveManually: string;
      };
      syncConflict: {
        title: string;
        description: string;
        conflictFiles: string;
        resolveManually: string;
      };
      processing: string;
    };
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
      tooltipTitle: string;
      tooltipDescription: string;
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

  // Claude Usage Dashboard
  usage: {
    title: string;
    description: string;
    notConnected: string;
    connectPrompt: string;
    connectButton: string;
    error: string;
    refreshing: string;
    retry: string;
    noData: string;
    noDataDescription: string;
    refresh: string;
    used: string;
    remaining: string;
    resetsIn: string;
    criticalWarning: string;

    fiveHour: {
      title: string;
      description: string;
    };

    sevenDay: {
      title: string;
      description: string;
    };

    sonnet: {
      title: string;
      description: string;
    };

    opus: {
      title: string;
      description: string;
    };

    extra: {
      title: string;
      description: string;
      currentSpending: string;
      budgetLimit: string;
    };

    plan: {
      title: string;
    };
  };

  // OpenAI Usage Dashboard
  openaiUsage: {
    title: string;
    description: string;
    notConnected: string;
    connectPrompt: string;
    connectButton: string;
    error: string;
    refreshing: string;
    retry: string;
    noData: string;
    noDataDescription: string;
    refresh: string;
    used: string;
    remaining: string;
    resetsIn: string;
    criticalWarning: string;

    fiveHour: {
      title: string;
      description: string;
    };

    sevenDay: {
      title: string;
      description: string;
    };

    credits: {
      title: string;
      description: string;
      balance: string;
      unlimited: string;
    };

    codeReview: {
      title: string;
      description: string;
    };

    plan: {
      title: string;
    };
  };

  // GitHub Copilot Usage Dashboard
  githubCopilotUsage: {
    title: string;
    description: string;
    notConnected: string;
    connectPrompt: string;
    connectButton: string;
    error: string;
    refreshing: string;
    retry: string;
    noData: string;
    noDataDescription: string;
    refresh: string;
    used: string;
    remaining: string;
    total: string;
    resetsOn: string;
    criticalWarning: string;

    usage: {
      title: string;
      description: string;
    };

    plan: {
      title: string;
    };
  };

  zhipuUsage: {
    title: string;
    description: string;
    notConfigured: string;
    configurePrompt: string;
    configureButton: string;
    error: string;
    refreshing: string;
    retry: string;
    noData: string;
    noDataDescription: string;
    refresh: string;
    used: string;
    remaining: string;
    limit: string;
    resetsIn: string;
    criticalWarning: string;

    fiveHour: {
      title: string;
      description: string;
    };

    plan: {
      title: string;
    };

    modelUsage: {
      title: string;
      description: string;
    };
  };

  minimaxUsage: {
    title: string;
    description: string;
    notConfigured: string;
    configurePrompt: string;
    configureButton: string;
    sessionExpired: string;
    sessionExpiredDescription: string;
    updateCookie: string;
    error: string;
    refreshing: string;
    retry: string;
    noData: string;
    noDataDescription: string;
    refresh: string;
    used: string;
    remaining: string;
    resetsIn: string;
    lastValidated: string;
    criticalWarning: string;

    fiveHour: {
      title: string;
      description: string;
    };

    plan: {
      title: string;
    };
  };

  kimiUsage: {
    title: string;
    description: string;
    notConfigured: string;
    configurePrompt: string;
    configureButton: string;
    sessionExpired: string;
    sessionExpiredDescription: string;
    updateCookie: string;
    error: string;
    refreshing: string;
    retry: string;
    noData: string;
    noDataDescription: string;
    refresh: string;
    used: string;
    remaining: string;
    resetsIn: string;
    lastValidated: string;
    criticalWarning: string;

    weekly: {
      title: string;
      description: string;
    };

    fiveHour: {
      title: string;
      description: string;
    };
  };

  apiUsage: {
    title: string;
    description: string;
    tabLabel: string;
    dashboardTitle: string;
    dashboardDescription: string;
    rangeLabel: string;
    loading: string;
    noData: string;
    ranges: {
      today: string;
      week: string;
      month: string;
    };
    metrics: {
      cost: string;
      totalTokens: string;
      outputTokens: string;
      requests: string;
    };
    tokens: {
      title: string;
      description: string;
      selectLabel: string;
      chartLabel: string;
      options: {
        total: string;
        input: string;
        output: string;
      };
      summary: {
        totalSuffix: string;
        average: string;
        perDay: string;
        peak: string;
      };
    };
    cost: {
      title: string;
      description: string;
      chartLabel: string;
      summary: {
        total: string;
      };
    };
    requests: {
      title: string;
      description: string;
      chartLabel: string;
      summary: {
        total: string;
      };
    };
    models: {
      title: string;
      description: string;
      summaryLabel: string;
      columns: {
        model: string;
        min: string;
        max: string;
        avg: string;
        sum: string;
        requests: string;
      };
    };
  };

  DbQuery: {
    summary: {
      title: string;
      totalRecords: string;
      average: string;
      minimum: string;
      maximum: string;
      sum: string;
      count: string;
      noData: string;
    };
    table: {
      title: string;
      loading: string;
      noData: string;
      rowsPerPage: string;
      pageOf: (current: number, total: number) => string;
      previousPage: string;
      nextPage: string;
      firstPage: string;
      lastPage: string;
    };
    chart: {
      noData: string;
      xAxis: string;
      yAxis: string;
      valueLabel: string;
    };
    grid: {
      title: string;
      noData: string;
      tabs: {
        summary: string;
        chart: string;
        table: string;
      };
    };
  };

  Lsp: {
    // Severity
    showErrors: string;
    showWarnings: string;
    showInfo: string;
    showHints: string;

    // Settings
    settings: {
      title: string;
      description: string;
      tooltipTitle: string;
      tooltipDescription: string;
      enableLsp: string;
      enableLspDesc: string;
      supportedLanguages: string;
      showDiagnostics: string;
      showDiagnosticsDesc: string;
      severitySettings: string;
      severitySettingsDesc: string;
    };
  };

  ToolMessages: {
    Lsp: {
      projectRootNotSet: string;
      fileNotFound: (path: string) => string;
      noLspSupport: string;
      serverNotInstalled: (language: string) => string;
      serverNotAvailable: (command: string) => string;
      languageIdMissing: string;
      positionRequired: (operation: string) => string;
      operationNotSupported: (operation: string) => string;
      noResults: (operation: string) => string;
      success: (operation: string, location: string) => string;
      failed: (operation: string, message: string) => string;
      unknownError: string;
    };
    Bash: {
      outputSaved: (path: string) => string;
      errorSaved: (path: string) => string;
    };
  };

  Share: {
    title: string;
    description: string;
    messages: string;
    emptyTask: string;
    created: string;
    failed: string;
    copyFailed: string;
    expiresIn: string;
    expires1d: string;
    expires7d: string;
    expires30d: string;
    expiresNever: string;
    passwordProtection: string;
    passwordPlaceholder: string;
    privacyNotice: string;
    copyLink: string;
    openInBrowser: string;
    passwordSet: string;
    createLink: string;
  };

  CustomTools?: {
    page: {
      tooltipTitle: string;
      tooltipDescription: string;
    };
  };

  playground: {
    title: string;
    newTool: string;
    newToolDescription: string;
    codeEditor: string;
    parameters: string;
    result: string;
    history: string;
    settings: string;
    compile: string;
    compiling: string;
    compileSuccess: string;
    compileFailed: string;
    compileFirst: string;
    execute: string;
    executing: string;
    executionSuccess: string;
    executionFailed: string;
    output: string;
    rendered: string;
    logs: string;
    noLogs: string;
    noExecutionResult: string;
    executionHistory: string;
    noHistory: string;
    executeToCreateHistory: string;
    noMatchingHistory: string;
    searchHistory: string;
    clearHistory: string;
    confirmClearHistory: string;
    historyCleared: string;
    executionReplayed: string;
    paramsCopied: string;
    outputCopied: string;
    outputDownloaded: string;
    parameterPresets: string;
    savePreset: string;
    load: string;
    selectPreset: string;
    presetSaved: string;
    presetLoaded: string;
    presetDeleted: string;
    confirmDeletePreset: string;
    presetNamePrompt: string;
    delete: string;
    noParameters: string;
    optional: string;
    parametersFromLastRun: string;
    requiredPermissions: string;
    noRenderer: string;
    renderFailed: string;
    renderInvalidResult: string;
    configUpdated: string;
    install: string;
    installing: string;
    installSuccess: string;
    installSuccessDescription: string;
    installFailed: string;
    error: {
      initFailed: string;
      noSession: string;
      validationFailed: string;
      executionFailed: string;
      compileFailed: string;
      savePresetFailed: string;
      loadPresetFailed: string;
      replayFailed: string;
    };
  };
}

export type LocaleMap = {
  [key in SupportedLocale]: LocaleDefinition;
};
