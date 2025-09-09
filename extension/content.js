// @ts-check
/// <reference path="../types/chrome.d.ts" />
/// <reference path="../types/index.js" />


//*********** GLOBAL VARIABLES **********//
/** @type {ExtensionStatusJSON} */
const extensionStatusJSON_bug = {
  "status": 400,
  "message": `<strong>Meeting Assistant encountered an error</strong> <br /> Please try reloading the meeting tab.`
}

const reportErrorMessage = "There is a bug in Meeting Assistant. Please reload and try again."
/** @type {MutationObserverInit} */
const mutationConfig = { childList: true, attributes: true, subtree: true, characterData: true }

// Name of the person attending the meeting
let userName = "You"

// Transcript array that holds one or more transcript blocks
/** @type {TranscriptBlock[]} */
let transcript = []

// Buffer variables to dump values, which get pushed to transcript array as transcript blocks, at defined conditions
let personNameBuffer = "", transcriptTextBuffer = "", timestampBuffer = ""

// Chat messages array that holds one or more chat messages of the meeting
/** @type {ChatMessage[]} */
let chatMessages = []

// Capture meeting start timestamp, stored in ISO format
let meetingStartTimestamp = new Date().toISOString()
let meetingTitle = document.title

// Capture invalid transcript and chatMessages DOM element error for the first time and silence for the rest of the meeting to prevent notification noise
let isTranscriptDomErrorCaptured = false
let isChatMessagesDomErrorCaptured = false

// Capture meeting begin to abort userName capturing interval
let hasMeetingStarted = false

// Capture meeting end to suppress any errors
let hasMeetingEnded = false

/** @type {ExtensionStatusJSON} */
let extensionStatusJSON

let canUseAriaBasedTranscriptSelector = true

//*********** MAIN FUNCTIONS **********//
checkExtensionStatus().finally(() => {
  // Read the status JSON
  chrome.storage.local.get(["extensionStatusJSON"], function (resultLocalUntyped) {
    const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
    extensionStatusJSON = resultLocal.extensionStatusJSON
    console.log("Extension status " + extensionStatusJSON.status)

    // Enable extension functions only if status is 200
    if (extensionStatusJSON.status === 200) {

    
      overWriteChromeStorage(["meetingStartTimestamp", "meetingTitle", "transcript", "chatMessages"], false);
      // ---------------------

      // NON CRITICAL DOM DEPENDENCY. Attempt to get username...
      waitForElement(".awLEm").then(() => {
        // Poll the element until the textContent loads from network or until meeting starts
        const captureUserNameInterval = setInterval(() => {
          if (!hasMeetingStarted) {
            const capturedUserName = document.querySelector(".awLEm")?.textContent
            if (capturedUserName) {
              userName = capturedUserName
              clearInterval(captureUserNameInterval)
            }
          }
          else {
            clearInterval(captureUserNameInterval)
          }
        }, 100)
      })

      // 2. Meet UI post July/Aug 2024
      meetingRoutines(2)
    }
    else {
      // Show downtime message as extension status is 400
      showNotification(extensionStatusJSON)
    }
  })
})


/**
 * @param {number} uiType
 */
function meetingRoutines(uiType) {
  const meetingEndIconData = {
    selector: "",
    text: ""
  }
  const captionsIconData = {
    selector: "",
    text: ""
  }
  // Different selector data for different UI versions
  switch (uiType) {
    case 1:
      meetingEndIconData.selector = ".google-material-icons"
      meetingEndIconData.text = "call_end"
      captionsIconData.selector = ".material-icons-extended"
      captionsIconData.text = "closed_caption_off"
      break
    case 2:
      meetingEndIconData.selector = ".google-symbols"
      meetingEndIconData.text = "call_end"
      captionsIconData.selector = ".google-symbols"
      captionsIconData.text = "closed_caption_off"
    default:
      break
  }

  // CRITICAL DOM DEPENDENCY. Wait until the meeting end icon appears, used to detect meeting start
  waitForElement(meetingEndIconData.selector, meetingEndIconData.text).then(() => {
    console.log("Meeting started")
    /** @type {ExtensionMessage} */
    const message = {
      type: "new_meeting_started"
    }
    chrome.runtime.sendMessage(message, function () { })
    hasMeetingStarted = true


    //*********** MEETING START ROUTINES **********//
    updateMeetingTitle()

    /** @type {MutationObserver} */
    let transcriptObserver
    /** @type {MutationObserver} */
    let chatMessagesObserver

  
    waitForElement(captionsIconData.selector, captionsIconData.text).then(() => {
      // CRITICAL DOM DEPENDENCY
      const captionsButton = selectElements(captionsIconData.selector, captionsIconData.text)[0]

      // Click captions icon for non manual operation modes. Async operation.
      chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
        const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
        if (resultSync.operationMode === "manual") {
          console.log("Manual mode selected, leaving transcript off")
        }
        else {
          captionsButton.click()
        }
      })

      // Allow DOM to be updated and then register chatMessage mutation observer
      waitForElement(`div[role="region"][tabindex="0"]`).then(() => {
        // CRITICAL DOM DEPENDENCY. Grab the transcript element. This element is present, irrespective of captions ON/OFF, so this executes independent of operation mode.
        let transcriptTargetNode = document.querySelector(`div[role="region"][tabindex="0"]`)
    

        if (transcriptTargetNode) {
          // Attempt to dim down the transcript
          canUseAriaBasedTranscriptSelector
            ? transcriptTargetNode.setAttribute("style", "opacity:0.2")
            : transcriptTargetNode.children[1].setAttribute("style", "opacity:0.2")

          // Create transcript observer instance linked to the callback function. Registered irrespective of operation mode, so that any visible transcript can be picked up during the meeting, independent of the operation mode.
          transcriptObserver = new MutationObserver(transcriptMutationCallback)

          // Start observing the transcript element and chat messages element for configured mutations
          transcriptObserver.observe(transcriptTargetNode, mutationConfig)
        }
        else {
          throw new Error("Transcript element not found in DOM")
        }
      })
        .catch((err) => {
          console.error(err)
          isTranscriptDomErrorCaptured = true
          showNotification(extensionStatusJSON_bug)

          logError("001", err)
        })
    })


    // **** REGISTER CHAT MESSAGES LISTENER **** //
    // Wait for chat icon to be visible. When user is waiting in meeting lobbing for someone to let them in, the call end icon is visible, but the chat icon is still not visible.
    waitForElement(".google-symbols", "chat").then(() => {
      const chatMessagesButton = selectElements(".google-symbols", "chat")[0]
      // Force open chat messages to make the required DOM to appear. Otherwise, the required chatMessages DOM element is not available.
      chatMessagesButton.click()

      // Allow DOM to be updated, close chat messages and then register chatMessage mutation observer
      waitForElement(`div[aria-live="polite"].Ge9Kpc`).then(() => {
        chatMessagesButton.click()
        // CRITICAL DOM DEPENDENCY. Grab the chat messages element. This element is present, irrespective of chat ON/OFF, once it appears for this first time.
        try {
          const chatMessagesTargetNode = document.querySelector(`div[aria-live="polite"].Ge9Kpc`)

          // Create chat messages observer instance linked to the callback function. Registered irrespective of operation mode.
          if (chatMessagesTargetNode) {
            chatMessagesObserver = new MutationObserver(chatMessagesMutationCallback)
            chatMessagesObserver.observe(chatMessagesTargetNode, mutationConfig)
          }
          else {
            throw new Error("Chat messages element not found in DOM")
          }
        } catch (err) {
          console.error(err)
          isChatMessagesDomErrorCaptured = true
          showNotification(extensionStatusJSON_bug)

          logError("002", err)
        }
      })
    })
      .catch((err) => {
        console.error(err)
        isChatMessagesDomErrorCaptured = true
        showNotification(extensionStatusJSON_bug)

        logError("003", err)
      })

    // Show confirmation message from extensionStatusJSON, once observation has started, based on operation mode
    if (!isTranscriptDomErrorCaptured && !isChatMessagesDomErrorCaptured) {
      chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
        const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
        if (resultSync.operationMode === "manual") {
          showNotification({ status: 400, message: "<strong>Meeting Assistant is in manual mode.</strong> <br /> Turn on captions if you wish to record." })
        }
        else {
          showNotification(extensionStatusJSON)
        }
      })
    }

    //*********** MEETING END ROUTINES **********//
    try {
      // CRITICAL DOM DEPENDENCY. Event listener to capture meeting end button click by user
      selectElements(meetingEndIconData.selector, meetingEndIconData.text)[0].parentElement.parentElement.addEventListener("click", () => {
        // To suppress further errors
        hasMeetingEnded = true
        if (transcriptObserver) {
          transcriptObserver.disconnect()
        }
        if (chatMessagesObserver) {
          chatMessagesObserver.disconnect()
        }

        // Push any data in the buffer variables to the transcript array, but avoid pushing blank ones. Needed to handle one or more speaking when meeting ends.
        if ((personNameBuffer !== "") && (transcriptTextBuffer !== "")) {
          pushBufferToTranscript()
        }
        // Save to chrome storage and send message to download transcript from background script
        overWriteChromeStorage(["transcript", "chatMessages"], true)
      })
    } catch (err) {
      console.error(err)
      showNotification(extensionStatusJSON_bug)

      logError("004", err)
    }
  })
}





//*********** CALLBACK FUNCTIONS **********//
// Callback function to execute when transcription mutations are observed. 
/**
 * @param {MutationRecord[]} mutationsList
 */
function transcriptMutationCallback(mutationsList) {
  mutationsList.forEach(() => {
    try {
      // CRITICAL DOM DEPENDENCY. Get all people in the transcript
      const people = canUseAriaBasedTranscriptSelector
        ? document.querySelector(`div[role="region"][tabindex="0"]`)?.children
        : document.querySelector(".a4cQT")?.childNodes[1]?.firstChild?.childNodes

      if (people) {
        /// In aria based selector case, the last people element is "Jump to bottom" button. So, pick up only if more than 1 element is available.
        if (canUseAriaBasedTranscriptSelector ? (people.length > 1) : (people.length > 0)) {
          // Get the last person
          const person = canUseAriaBasedTranscriptSelector
            ? people[people.length - 2]
            : people[people.length - 1]
          // CRITICAL DOM DEPENDENCY
          const currentPersonName = person.childNodes[0].textContent
          // CRITICAL DOM DEPENDENCY
          const currentTranscriptText = person.childNodes[1].textContent

          if (currentPersonName && currentTranscriptText) {
            // Starting fresh in a meeting or resume from no active transcript
            if (transcriptTextBuffer === "") {
              personNameBuffer = currentPersonName
              timestampBuffer = new Date().toISOString()
              transcriptTextBuffer = currentTranscriptText
            }
            // Some prior transcript buffer exists
            else {
              // New person started speaking 
              if (personNameBuffer !== currentPersonName) {
                // Push previous person's transcript as a block
                pushBufferToTranscript()

                // Update buffers for next mutation and store transcript block timestamp
                personNameBuffer = currentPersonName
                timestampBuffer = new Date().toISOString()
                transcriptTextBuffer = currentTranscriptText
              }
              // Same person speaking more
              else {
                if (canUseAriaBasedTranscriptSelector) {
                  // When the same person speaks for more than 30 min (approx), Meet drops very long transcript for current person and starts over, which is detected by current transcript string being significantly smaller than the previous one
                  if ((currentTranscriptText.length - transcriptTextBuffer.length) < -250) {
                    // Push the long transcript
                    pushBufferToTranscript()

                    // Store transcript block timestamp for next transcript block of same person
                    timestampBuffer = new Date().toISOString()
                  }
                }
                else {
                  // If a person is speaking for a long time, Google Meet does not keep the entire text in the spans. Starting parts are automatically removed in an unpredictable way as the length increases and MeetAssist will miss them. So we force remove a lengthy transcript node in a controlled way. Google Meet will add a fresh person node when we remove it and continue transcription. MeetAssist picks it up as a new person and nothing is missed.
                  if (currentTranscriptText.length > 250) {
                    person.remove()
                  }
                }

                // Update buffers for next mutation. This has to be done irrespective of any condition.
                transcriptTextBuffer = currentTranscriptText
              }
            }
          }
        }
        // No people found in transcript DOM
        else {
          // No transcript yet or the last person stopped speaking(and no one has started speaking next)
          console.log("No active transcript")
          // Push data in the buffer variables to the transcript array, but avoid pushing blank ones.
          if ((personNameBuffer !== "") && (transcriptTextBuffer !== "")) {
            pushBufferToTranscript()
          }
          // Update buffers for the next person in the next mutation
          personNameBuffer = ""
          transcriptTextBuffer = ""
        }
      }

      // Logs to indicate that the extension is working
      if (transcriptTextBuffer.length > 125) {
        console.log(transcriptTextBuffer.slice(0, 50) + " ... " + transcriptTextBuffer.slice(-50))
      }
      else {
        console.log(transcriptTextBuffer)
      }
    } catch (err) {
      console.error(err)
      if (!isTranscriptDomErrorCaptured && !hasMeetingEnded) {
        console.log(reportErrorMessage)
        showNotification(extensionStatusJSON_bug)

        logError("005", err)
      }
      isTranscriptDomErrorCaptured = true
    }
  })
}

// Callback function to execute when chat messages mutations are observed. 
/**
 * @param {MutationRecord[]} mutationsList
 */
function chatMessagesMutationCallback(mutationsList) {
  mutationsList.forEach(() => {
    try {
      // CRITICAL DOM DEPENDENCY
      const chatMessagesElement = document.querySelector(`div[aria-live="polite"].Ge9Kpc`)
      // Attempt to parse messages only if at least one message exists
      if (chatMessagesElement && chatMessagesElement.children.length > 0) {
        // CRITICAL DOM DEPENDENCY. Get the last message that was sent/received.
        const chatMessageElement = chatMessagesElement.lastChild
        // CRITICAL DOM DEPENDENCY
        const personName = chatMessageElement?.firstChild?.firstChild?.textContent
        const timestamp = new Date().toISOString()
        // CRITICAL DOM DEPENDENCY. Some mutations will have some noisy text at the end, which is handled in pushUniqueChatBlock function.
        const chatMessageText = chatMessageElement?.lastChild?.lastChild?.textContent

        if (personName && chatMessageText) {
          /**@type {ChatMessage} */
          const chatMessageBlock = {
            "personName": personName === "You" ? userName : personName,
            "timestamp": timestamp,
            "chatMessageText": chatMessageText
          }

          // Lot of mutations fire for each message, pick them only once
          pushUniqueChatBlock(chatMessageBlock)
        }
      }
    }
    catch (err) {
      console.error(err)
      if (!isChatMessagesDomErrorCaptured && !hasMeetingEnded) {
        console.log(reportErrorMessage)
        showNotification(extensionStatusJSON_bug)

        logError("006", err)
      }
      isChatMessagesDomErrorCaptured = true
    }
  })
}










//*********** HELPER FUNCTIONS **********//
// Pushes data in the buffer to transcript array as a transcript block
function pushBufferToTranscript() {
  transcript.push({
    "personName": personNameBuffer === "You" ? userName : personNameBuffer,
    "timestamp": timestampBuffer,
    "transcriptText": transcriptTextBuffer
  })
  overWriteChromeStorage(["transcript"], false)
}

// Pushes object to array only if it doesn't already exist. chatMessage is checked for substring since some trailing text(keep Pin message) is present from a button that allows to pin the message.
/**
 * @param {ChatMessage} chatBlock
 */
function pushUniqueChatBlock(chatBlock) {
  const isExisting = chatMessages.some(item =>
    item.personName === chatBlock.personName &&
    chatBlock.chatMessageText.includes(item.chatMessageText)
  )
  if (!isExisting) {
    console.log(chatBlock)
    chatMessages.push(chatBlock)
    overWriteChromeStorage(["chatMessages"], false)
  }
}

// Saves specified variables to chrome storage. Optionally, can send message to background script to download, post saving.
/**
 * @param {Array<"transcript" | "meetingTitle" | "meetingStartTimestamp" | "chatMessages">} keys
 * @param {boolean} sendDownloadMessage
 */
function overWriteChromeStorage(keys, sendDownloadMessage) {
  const objectToSave = {}
  // Hard coded list of keys that are accepted
  if (keys.includes("transcript")) {
    objectToSave.transcript = transcript
  }
  if (keys.includes("meetingTitle")) {
    objectToSave.meetingTitle = meetingTitle
  }
  if (keys.includes("meetingStartTimestamp")) {
    objectToSave.meetingStartTimestamp = meetingStartTimestamp
  }
  if (keys.includes("chatMessages")) {
    objectToSave.chatMessages = chatMessages
  }

  chrome.storage.local.set(objectToSave, function () {
    // Helps people know that the extension is working smoothly in the background
    pulseStatus()
    if (sendDownloadMessage) {
      /** @type {ExtensionMessage} */
      const message = {
        type: "meeting_ended"
      }
      chrome.runtime.sendMessage(message, (responseUntyped) => {
        const response = /** @type {ExtensionResponse} */ (responseUntyped)
        if (!response.success) {
          console.error(response.message)
        }
      })
    }
  })
}

function pulseStatus() {
  const statusActivityCSS = `position: fixed;
    top: 0px;
    width: 100%;
    height: 4px;
    z-index: 100;
    transition: background-color 0.3s ease-in
  `

  // --- BUG FIX 1: THE SELECTOR WAS MISSING A '#' ---
  // It must be an ID selector to find the element
  let activityStatus = document.querySelector(`#meeting-assistant-status`)

  if (!activityStatus) {
    let html = document.querySelector("html")
    activityStatus = document.createElement("div")
    activityStatus.setAttribute("id", "meeting-assistant-status")
    

    activityStatus.style.cssText = `background-color: #D1B5A3; ${statusActivityCSS}`
    html?.appendChild(activityStatus)
  }
  else {
    activityStatus.style.cssText = `background-color: #D1B5A3; ${statusActivityCSS}`
  }

  setTimeout(() => {
    activityStatus.style.cssText = `background-color: transparent; ${statusActivityCSS}`
  }, 3000)
}


// Grabs updated meeting title, if available
function updateMeetingTitle() {
  try {
    waitForElement(".u6vdEc").then(() => {
      // Pick up meeting name after a delay, since Google meet updates meeting name after a delay
      setTimeout(() => {
        // NON CRITICAL DOM DEPENDENCY
        const meetingTitleElement = document.querySelector(".u6vdEc")
        if (meetingTitleElement?.textContent) {
          meetingTitle = meetingTitleElement.textContent
          overWriteChromeStorage(["meetingTitle"], false)
        } else {
          throw new Error("Meeting title element not found in DOM")
        }
      }, 5000)
    })
  } catch (err) {
    console.error(err)

    if (!hasMeetingEnded) {
      logError("007", err)
    }
  }

}

// Returns all elements of the specified selector type and specified textContent. Return array contains the actual element as well as all the parents. 
/**
 * @param {string} selector
 * @param {string | RegExp} text
 */
function selectElements(selector, text) {
  var elements = document.querySelectorAll(selector)
  return Array.prototype.filter.call(elements, function (element) {
    return RegExp(text).test(element.textContent)
  })
}

// Efficiently waits until the element of the specified selector and textContent appears in the DOM. Polls only on animation frame change
/**
 * @param {string} selector
 * @param {string | RegExp} [text]
 */
async function waitForElement(selector, text) {
  if (text) {
    // loops for every animation frame change, until the required element is found
    while (!Array.from(document.querySelectorAll(selector)).find(element => element.textContent === text)) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  }
  else {
    // loops for every animation frame change, until the required element is found
    while (!document.querySelector(selector)) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  }
  return document.querySelector(selector)
}

// Shows a responsive notification of specified type and message
/**
 * @param {ExtensionStatusJSON} extensionStatusJSON
 */
function showNotification(extensionStatusJSON) {
  // Banner CSS
  let html = document.querySelector("html")
  let obj = document.createElement("div")
  let logo = document.createElement("img")
  let text = document.createElement("p")

  logo.setAttribute(
    "src",
    chrome.runtime.getURL("icon.png")
  )
  logo.setAttribute("height", "32px")
  logo.setAttribute("width", "32px")
  logo.style.cssText = "border-radius: 4px"

  // Remove banner after 5s
  setTimeout(() => {
    obj.style.display = "none"
  }, 5000)

  if (extensionStatusJSON.status === 200) {
    obj.style.cssText = `color: #D1B5A3; ${commonCSS}`
    text.innerHTML = extensionStatusJSON.message
  }
  else {
    obj.style.cssText = `color: orange; ${commonCSS}`
    text.innerHTML = extensionStatusJSON.message
  }

  obj.prepend(text)
  obj.prepend(logo)
  if (html)
    html.append(obj)
}

// CSS for notification
const commonCSS = `background: rgb(255 255 255 / 10%); 
    backdrop-filter: blur(16px); 
    position: fixed;
    top: 5%; 
    left: 0; 
    right: 0; 
    margin-left: auto; 
    margin-right: auto;
    max-width: 780px;  
    z-index: 1000; 
    padding: 0rem 1rem;
    border-radius: 8px; 
    display: flex; 
    justify-content: center; 
    align-items: center; 
    gap: 16px;  
    font-size: 1rem; 
    line-height: 1.5; 
    font-family: "Google Sans",Roboto,Arial,sans-serif; 
    box-shadow: rgba(0, 0, 0, 0.16) 0px 10px 36px 0px, rgba(0, 0, 0, 0.06) 0px 0px 0px 1px;`


// Logs anonymous errors to the local console for debugging.
/**
 * @param {string} code
 * @param {any} err
 */
function logError(code, err) {
  // This function is now disabled to prevent sending data to external servers.
  // We will just log the error to the user's own console.
  console.error(`Meeting Assistant Error Code: ${code}`, err);
}


// Fetches extension status. We now just hardcode the success message locally.
function checkExtensionStatus() {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      extensionStatusJSON: { 
          status: 200, 
          message: "<strong>Meeting Conversational Assistant is running</strong> <br /> Do not turn off captions" 
        },
    });
    resolve("Extension status set locally.");
  });
}

function recoverLastMeeting() {
  return new Promise((resolve, reject) => {
    /** @type {ExtensionMessage} */
    const message = {
      type: "recover_last_meeting",
    }
    chrome.runtime.sendMessage(message, function (responseUntyped) {
      const response = /** @type {ExtensionResponse} */ (responseUntyped)
      if (response.success) {
        resolve("Last meeting recovered successfully or recovery not needed")
      }
      else {
        reject(response.message)
      }
    })
  })
}





