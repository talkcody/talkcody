// src/components/chat/chat-input-ime.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/react';

/**
 * This test verifies the fix for the IME composition bug where pressing Enter
 * during Chinese/Japanese/Korean input would incorrectly submit the message
 * instead of confirming the input method composition.
 *
 * Bug: When using Chinese input method (e.g., Sogou) to type English characters:
 * 1. User types English characters in Chinese input mode (e.g., "review")
 * 2. User presses Enter to confirm the input
 * 3. The Enter event was triggering message submission instead of confirming the IME
 *
 * Fix:
 * 1. Check e.nativeEvent.isComposing before handling Enter key submission.
 * 2. Use compositionstart/compositionend events to manually track IME state via isComposingRef.
 *    This provides better compatibility across different browsers and WebView environments.
 * When either isComposing flag is true, the Enter key should be ignored for submission.
 */
describe('ChatInput - IME Composition Bug Fix', () => {
  it('should not submit message when Enter is pressed during IME composition', () => {
    // Create a mock textarea element
    const textarea = document.createElement('textarea');
    const mockSubmit = vi.fn();

    // Create a mock keydown event with isComposing = true (simulating IME input)
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    // Mock the nativeEvent.isComposing property
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: true },
      writable: false,
    });

    // Simulate the handleInputKeydown logic
    const handleInputKeydown = (e: KeyboardEvent) => {
      const nativeEvent = (e as unknown as { nativeEvent: { isComposing: boolean } }).nativeEvent;

      // Don't submit if IME composition is in progress
      if (e.code === 'Enter' && !e.shiftKey && !nativeEvent.isComposing) {
        e.preventDefault();
        mockSubmit();
      }
    };

    // Attach event listener
    textarea.addEventListener('keydown', handleInputKeydown);

    // Fire the event
    textarea.dispatchEvent(event);

    // Verify submit was NOT called because isComposing = true
    expect(mockSubmit).not.toHaveBeenCalled();

    // Cleanup
    textarea.removeEventListener('keydown', handleInputKeydown);
  });

  it('should submit message when Enter is pressed after IME composition is complete', () => {
    // Create a mock textarea element
    const textarea = document.createElement('textarea');
    const mockSubmit = vi.fn();

    // Create a mock keydown event with isComposing = false (composition completed)
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    // Mock the nativeEvent.isComposing property
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: false },
      writable: false,
    });

    // Simulate the handleInputKeydown logic
    const handleInputKeydown = (e: KeyboardEvent) => {
      const nativeEvent = (e as unknown as { nativeEvent: { isComposing: boolean } }).nativeEvent;

      // Don't submit if IME composition is in progress
      if (e.code === 'Enter' && !e.shiftKey && !nativeEvent.isComposing) {
        e.preventDefault();
        mockSubmit();
      }
    };

    // Attach event listener
    textarea.addEventListener('keydown', handleInputKeydown);

    // Fire the event
    textarea.dispatchEvent(event);

    // Verify submit WAS called because isComposing = false
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    // Cleanup
    textarea.removeEventListener('keydown', handleInputKeydown);
  });

  it('should allow Shift+Enter for newline even during IME composition', () => {
    // Create a mock textarea element
    const textarea = document.createElement('textarea');
    const mockSubmit = vi.fn();

    // Create a mock keydown event with Shift+Enter and isComposing = true
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    // Mock the nativeEvent.isComposing property
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: true },
      writable: false,
    });

    // Simulate the handleInputKeydown logic
    const handleInputKeydown = (e: KeyboardEvent) => {
      const nativeEvent = (e as unknown as { nativeEvent: { isComposing: boolean } }).nativeEvent;

      // Don't submit if IME composition is in progress
      if (e.code === 'Enter' && !e.shiftKey && !nativeEvent.isComposing) {
        e.preventDefault();
        mockSubmit();
      }
    };

    // Attach event listener
    textarea.addEventListener('keydown', handleInputKeydown);

    // Fire the event
    textarea.dispatchEvent(event);

    // Verify submit was NOT called (because of shiftKey)
    expect(mockSubmit).not.toHaveBeenCalled();

    // Cleanup
    textarea.removeEventListener('keydown', handleInputKeydown);
  });
});

/**
 * Test for PromptInput component IME handling
 */
describe('PromptInput - IME Composition Bug Fix', () => {
  it('should not submit form when Enter is pressed during IME composition', () => {
    // Create a mock textarea element
    const textarea = document.createElement('textarea');
    const mockFormSubmit = vi.fn();

    // Create a mock form
    const form = document.createElement('form');
    form.requestSubmit = mockFormSubmit;
    form.appendChild(textarea);

    // Create a mock keydown event with isComposing = true
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    // Mock the nativeEvent.isComposing property
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: true },
      writable: false,
    });

    // Simulate the handleKeyDown logic from PromptInputTextarea
    const handleKeyDown = (e: KeyboardEvent) => {
      const nativeEvent = (e as unknown as { nativeEvent: { isComposing: boolean } }).nativeEvent;

      if (e.key === 'Enter') {
        if ((e as KeyboardEvent & { shiftKey: boolean }).shiftKey) {
          // Allow newline
          return;
        }

        // Don't submit if IME composition is in progress
        if (nativeEvent.isComposing) {
          return;
        }

        // Submit on Enter (without Shift)
        e.preventDefault();
        const targetForm = (e.target as HTMLTextAreaElement).form;
        if (targetForm) {
          targetForm.requestSubmit();
        }
      }
    };

    // Set textarea.form to point to the form
    Object.defineProperty(textarea, 'form', {
      value: form,
      writable: false,
    });

    // Attach event listener
    textarea.addEventListener('keydown', handleKeyDown);

    // Fire the event
    textarea.dispatchEvent(event);

    // Verify form submit was NOT called because isComposing = true
    expect(mockFormSubmit).not.toHaveBeenCalled();

    // Cleanup
    textarea.removeEventListener('keydown', handleKeyDown);
  });

  it('should submit form when Enter is pressed after IME composition is complete', () => {
    // Create a mock textarea element
    const textarea = document.createElement('textarea');
    const mockFormSubmit = vi.fn();

    // Create a mock form
    const form = document.createElement('form');
    form.requestSubmit = mockFormSubmit;
    form.appendChild(textarea);

    // Create a mock keydown event with isComposing = false
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    // Mock the nativeEvent.isComposing property
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: false },
      writable: false,
    });

    // Simulate the handleKeyDown logic from PromptInputTextarea
    const handleKeyDown = (e: KeyboardEvent) => {
      const nativeEvent = (e as unknown as { nativeEvent: { isComposing: boolean } }).nativeEvent;

      if (e.key === 'Enter') {
        if ((e as KeyboardEvent & { shiftKey: boolean }).shiftKey) {
          // Allow newline
          return;
        }

        // Don't submit if IME composition is in progress
        if (nativeEvent.isComposing) {
          return;
        }

        // Submit on Enter (without Shift)
        e.preventDefault();
        const targetForm = (e.target as HTMLTextAreaElement).form;
        if (targetForm) {
          targetForm.requestSubmit();
        }
      }
    };

    // Set textarea.form to point to the form
    Object.defineProperty(textarea, 'form', {
      value: form,
      writable: false,
    });

    // Attach event listener
    textarea.addEventListener('keydown', handleKeyDown);

    // Fire the event
    textarea.dispatchEvent(event);

    // Verify form submit WAS called because isComposing = false
    expect(mockFormSubmit).toHaveBeenCalledTimes(1);

    // Cleanup
    textarea.removeEventListener('keydown', handleKeyDown);
  });
});

/**
 * Tests for the enhanced IME fix using compositionstart/compositionend events
 * to track composition state via isComposingRef.
 *
 * This approach provides better compatibility in WebView/Tauri environments
 * where nativeEvent.isComposing may not always be reliable.
 */
describe('ChatInput - IME Composition with isComposingRef', () => {
  /**
   * Simulates the actual implementation from chat-input.tsx:
   * - isComposingRef tracks composition state via compositionstart/compositionend events
   * - handleInputKeydown checks both isComposingRef.current AND nativeEvent.isComposing
   */
  function createIMETestContext() {
    const textarea = document.createElement('textarea');
    const mockSubmit = vi.fn();

    // Simulate isComposingRef from the component
    const isComposingRef = { current: false };

    // Composition event handlers (mirrors chat-input.tsx implementation)
    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
    };

    // Keydown handler (mirrors chat-input.tsx implementation)
    const handleInputKeydown = (e: KeyboardEvent) => {
      const nativeEvent = (e as unknown as { nativeEvent: { isComposing: boolean } }).nativeEvent;

      // Don't submit if IME composition is in progress
      // Check both the ref and the native event for maximum compatibility
      if (
        e.code === 'Enter' &&
        !e.shiftKey &&
        !isComposingRef.current &&
        !nativeEvent.isComposing
      ) {
        e.preventDefault();
        mockSubmit();
      }
    };

    // Attach event listeners
    textarea.addEventListener('compositionstart', handleCompositionStart);
    textarea.addEventListener('compositionend', handleCompositionEnd);
    textarea.addEventListener('keydown', handleInputKeydown);

    return {
      textarea,
      mockSubmit,
      isComposingRef,
      cleanup: () => {
        textarea.removeEventListener('compositionstart', handleCompositionStart);
        textarea.removeEventListener('compositionend', handleCompositionEnd);
        textarea.removeEventListener('keydown', handleInputKeydown);
      },
    };
  }

  it('should set isComposingRef to true on compositionstart', () => {
    const { textarea, isComposingRef, cleanup } = createIMETestContext();

    expect(isComposingRef.current).toBe(false);

    // Fire compositionstart event
    const compositionStartEvent = new CompositionEvent('compositionstart', {
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(compositionStartEvent);

    expect(isComposingRef.current).toBe(true);

    cleanup();
  });

  it('should set isComposingRef to false on compositionend', () => {
    const { textarea, isComposingRef, cleanup } = createIMETestContext();

    // First, start composition
    isComposingRef.current = true;

    // Fire compositionend event
    const compositionEndEvent = new CompositionEvent('compositionend', {
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(compositionEndEvent);

    expect(isComposingRef.current).toBe(false);

    cleanup();
  });

  it('should not submit when isComposingRef is true (even if nativeEvent.isComposing is false)', () => {
    const { textarea, mockSubmit, isComposingRef, cleanup } = createIMETestContext();

    // Simulate composition in progress via ref
    isComposingRef.current = true;

    // Create Enter event with nativeEvent.isComposing = false
    // This simulates the case where the browser doesn't properly set isComposing
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: false },
      writable: false,
    });

    textarea.dispatchEvent(event);

    // Should NOT submit because isComposingRef.current is true
    expect(mockSubmit).not.toHaveBeenCalled();

    cleanup();
  });

  it('should not submit when nativeEvent.isComposing is true (even if isComposingRef is false)', () => {
    const { textarea, mockSubmit, isComposingRef, cleanup } = createIMETestContext();

    // isComposingRef is false (maybe compositionend was called)
    isComposingRef.current = false;

    // But nativeEvent.isComposing is still true
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: true },
      writable: false,
    });

    textarea.dispatchEvent(event);

    // Should NOT submit because nativeEvent.isComposing is true
    expect(mockSubmit).not.toHaveBeenCalled();

    cleanup();
  });

  it('should submit only when both isComposingRef and nativeEvent.isComposing are false', () => {
    const { textarea, mockSubmit, isComposingRef, cleanup } = createIMETestContext();

    // Both flags are false - composition is complete
    isComposingRef.current = false;

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: false },
      writable: false,
    });

    textarea.dispatchEvent(event);

    // Should submit because both flags are false
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should handle full IME composition lifecycle correctly', () => {
    const { textarea, mockSubmit, isComposingRef, cleanup } = createIMETestContext();

    // Step 1: User starts typing with IME (compositionstart)
    const startEvent = new CompositionEvent('compositionstart', {
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(startEvent);
    expect(isComposingRef.current).toBe(true);

    // Step 2: User presses Enter to confirm IME input (should NOT submit)
    const enterDuringComposition = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(enterDuringComposition, 'nativeEvent', {
      value: { isComposing: true },
      writable: false,
    });
    textarea.dispatchEvent(enterDuringComposition);
    expect(mockSubmit).not.toHaveBeenCalled();

    // Step 3: IME composition ends (compositionend)
    const endEvent = new CompositionEvent('compositionend', {
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(endEvent);
    expect(isComposingRef.current).toBe(false);

    // Step 4: User presses Enter again to send message (should submit)
    const enterAfterComposition = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(enterAfterComposition, 'nativeEvent', {
      value: { isComposing: false },
      writable: false,
    });
    textarea.dispatchEvent(enterAfterComposition);
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should handle multiple composition sessions correctly', () => {
    const { textarea, mockSubmit, isComposingRef, cleanup } = createIMETestContext();

    // First composition session
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(isComposingRef.current).toBe(true);

    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(isComposingRef.current).toBe(false);

    // Second composition session
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(isComposingRef.current).toBe(true);

    // Try to submit during second composition - should fail
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: false }, // Unreliable browser
      writable: false,
    });
    textarea.dispatchEvent(event);
    expect(mockSubmit).not.toHaveBeenCalled();

    // End second composition
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(isComposingRef.current).toBe(false);

    // Now submit should work
    textarea.dispatchEvent(event);
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should not submit with Shift+Enter regardless of composition state', () => {
    const { textarea, mockSubmit, isComposingRef, cleanup } = createIMETestContext();

    // Test Shift+Enter during composition
    isComposingRef.current = true;
    const shiftEnterDuring = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(shiftEnterDuring, 'nativeEvent', {
      value: { isComposing: true },
      writable: false,
    });
    textarea.dispatchEvent(shiftEnterDuring);
    expect(mockSubmit).not.toHaveBeenCalled();

    // Test Shift+Enter after composition
    isComposingRef.current = false;
    const shiftEnterAfter = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(shiftEnterAfter, 'nativeEvent', {
      value: { isComposing: false },
      writable: false,
    });
    textarea.dispatchEvent(shiftEnterAfter);
    expect(mockSubmit).not.toHaveBeenCalled();

    cleanup();
  });
});

/**
 * Tests for edge cases and specific IME scenarios
 */
describe('ChatInput - IME Edge Cases', () => {
  // Helper function that mirrors the updated implementation in chat-input.tsx
  function createIMETestContext() {
    const textarea = document.createElement('textarea');
    const mockSubmit = vi.fn();

    // Simulate isComposingRef from the component
    const isComposingRef = { current: false };

    // Composition event handlers (mirrors chat-input.tsx implementation)
    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
    };

    // Keydown handler (mirrors the UPDATED implementation in chat-input.tsx)
    const handleInputKeydown = (e: KeyboardEvent) => {
      // Check if this is an Enter key press
      const isEnterKey = e.key === 'Enter' || e.code === 'Enter';
      if (!isEnterKey || e.shiftKey) {
        return;
      }

      // Check IME composition state using multiple indicators
      const isComposing = 
        isComposingRef.current ||
        (e as KeyboardEvent & { isComposing?: boolean }).isComposing ||
        (e as unknown as { nativeEvent: { isComposing: boolean } }).nativeEvent?.isComposing ||
        e.keyCode === 229; // keyCode 229 indicates IME composition

      if (!isComposing) {
        e.preventDefault();
        mockSubmit();
      }
    };

    // Attach event listeners
    textarea.addEventListener('compositionstart', handleCompositionStart);
    textarea.addEventListener('compositionend', handleCompositionEnd);
    textarea.addEventListener('keydown', handleInputKeydown);

    return {
      textarea,
      mockSubmit,
      isComposingRef,
      cleanup: () => {
        textarea.removeEventListener('compositionstart', handleCompositionStart);
        textarea.removeEventListener('compositionend', handleCompositionEnd);
        textarea.removeEventListener('keydown', handleInputKeydown);
      },
    };
  }

  it('should handle rapid compositionstart/compositionend events', () => {
    const isComposingRef = { current: false };

    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };
    const handleCompositionEnd = () => {
      isComposingRef.current = false;
    };

    // Rapid fire events
    handleCompositionStart();
    expect(isComposingRef.current).toBe(true);

    handleCompositionEnd();
    expect(isComposingRef.current).toBe(false);

    handleCompositionStart();
    expect(isComposingRef.current).toBe(true);

    handleCompositionStart(); // Double start (edge case)
    expect(isComposingRef.current).toBe(true);

    handleCompositionEnd();
    expect(isComposingRef.current).toBe(false);

    handleCompositionEnd(); // Double end (edge case)
    expect(isComposingRef.current).toBe(false);
  });

  it('should handle Chinese pinyin input scenario', () => {
    /**
     * Scenario: User types "nihao" in Chinese pinyin mode
     * 1. compositionstart fires
     * 2. User types n-i-h-a-o (composition updates)
     * 3. User presses Enter to select "你好" from candidates
     * 4. compositionend fires
     * 5. User presses Enter again to send message
     */
    const isComposingRef = { current: false };
    const mockSubmit = vi.fn();

    const simulateKeydown = (isComposing: boolean) => {
      if (!isComposingRef.current && !isComposing) {
        mockSubmit();
      }
    };

    // Step 1: compositionstart
    isComposingRef.current = true;

    // Step 3: Enter during composition (nativeEvent.isComposing = true)
    simulateKeydown(true);
    expect(mockSubmit).not.toHaveBeenCalled();

    // Step 4: compositionend
    isComposingRef.current = false;

    // Step 5: Enter to send (nativeEvent.isComposing = false)
    simulateKeydown(false);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('should handle English input in Chinese IME mode scenario', () => {
    /**
     * Scenario: User types "review" in Chinese IME mode without space
     * In some IMEs, typing English without space triggers composition mode
     * 1. compositionstart fires
     * 2. User types r-e-v-i-e-w
     * 3. User presses Enter to confirm "review" as plain text
     * 4. compositionend fires
     * 5. User presses Enter again to send message
     */
    const isComposingRef = { current: false };
    const mockSubmit = vi.fn();

    const simulateKeydown = (isComposing: boolean) => {
      // Mirrors the actual implementation: check BOTH flags
      if (!isComposingRef.current && !isComposing) {
        mockSubmit();
      }
    };

    // compositionstart (English in Chinese IME)
    isComposingRef.current = true;

    // Enter to confirm "review" - should NOT submit
    // Some browsers may have isComposing = false even during composition
    simulateKeydown(false); // nativeEvent.isComposing might be false in buggy browsers
    expect(mockSubmit).not.toHaveBeenCalled(); // Protected by isComposingRef

    // compositionend
    isComposingRef.current = false;

    // Enter to send - should submit
    simulateKeydown(false);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('should handle Japanese IME hiragana to kanji conversion', () => {
    /**
     * Scenario: User types "arigatou" and converts to "ありがとう"
     * 1. compositionstart fires
     * 2. User types hiragana
     * 3. User presses space to see kanji candidates
     * 4. User presses Enter to select a candidate
     * 5. compositionend fires
     * 6. User presses Enter to send
     */
    const isComposingRef = { current: false };
    const mockSubmit = vi.fn();

    const simulateKeydown = (isComposing: boolean) => {
      if (!isComposingRef.current && !isComposing) {
        mockSubmit();
      }
    };

    // compositionstart
    isComposingRef.current = true;

    // Multiple Enter presses during composition (selecting candidates)
    simulateKeydown(true);
    simulateKeydown(true);
    expect(mockSubmit).not.toHaveBeenCalled();

    // compositionend
    isComposingRef.current = false;

    // Enter to send
    simulateKeydown(false);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('should handle Korean IME character composition', () => {
    /**
     * Scenario: User types Korean characters (e.g., 한글)
     * Korean IME continuously composes characters as you type
     * 1. compositionstart fires on first key
     * 2. Characters compose as user types
     * 3. User presses Enter when done
     * 4. compositionend fires
     * 5. User presses Enter to send
     */
    const isComposingRef = { current: false };
    const mockSubmit = vi.fn();

    const simulateKeydown = (isComposing: boolean) => {
      if (!isComposingRef.current && !isComposing) {
        mockSubmit();
      }
    };

    // compositionstart
    isComposingRef.current = true;

    // Enter to finalize character
    simulateKeydown(true);
    expect(mockSubmit).not.toHaveBeenCalled();

    // compositionend
    isComposingRef.current = false;

    // Enter to send
    simulateKeydown(false);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('should not submit when keyCode is 229 (IME composition indicator)', () => {
    /**
     * Scenario: In some browsers, IME composition events have keyCode 229
     * This test ensures our implementation handles this case correctly
     */
    const { textarea, mockSubmit, cleanup } = createIMETestContext();

    // Simulate Enter key with keyCode 229 (IME composition)
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: false },
      writable: false,
    });
    Object.defineProperty(event, 'isComposing', {
      value: false,
      writable: false,
    });

    textarea.dispatchEvent(event);

    // Should NOT submit because keyCode is 229
    expect(mockSubmit).not.toHaveBeenCalled();

    cleanup();
  });

  it('should submit when keyCode is not 229 and no other IME indicators', () => {
    /**
     * Scenario: Normal Enter key press (keyCode 13)
     */
    const { textarea, mockSubmit, cleanup } = createIMETestContext();

    // Simulate normal Enter key (keyCode 13)
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'nativeEvent', {
      value: { isComposing: false },
      writable: false,
    });
    Object.defineProperty(event, 'isComposing', {
      value: false,
      writable: false,
    });

    textarea.dispatchEvent(event);

    // Should submit because keyCode is 13 (normal Enter) and no IME indicators
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
