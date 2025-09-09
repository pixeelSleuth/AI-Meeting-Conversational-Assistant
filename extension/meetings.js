// @ts-check
/// <reference path="../types/chrome.d.ts" />
/// <reference path="../types/index.js" />

document.addEventListener("DOMContentLoaded", function () {
    
   
    
    const recoverLastMeetingButton = document.querySelector("#recover-last-meeting");

    // Initial load of transcripts
    loadMeetings();

    // Reload transcripts when page becomes visible
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            loadMeetings();
        }
    });

    if (recoverLastMeetingButton instanceof HTMLButtonElement) {
        recoverLastMeetingButton.addEventListener("click", function () {
            /** @type {ExtensionMessage} */
            const message = {
                type: "recover_last_meeting",
            }
            chrome.runtime.sendMessage(message, function (responseUntyped) {
                const response = /** @type {ExtensionResponse} */ (responseUntyped);
                loadMeetings();
                scrollTo({ top: 0, behavior: "smooth" });
                if (response.success) {
                    if (response.message === "No recovery needed") {
                        alert("Nothing to recover—you're all caught up!");
                    }
                    else {
                        alert("Last meeting recovered successfully!");
                    }
                }
                else {
                    if (response.message === "No meetings found. May be attend one?") {
                        alert(response.message);
                    }
                    else if (response.message === "Empty transcript and empty chatMessages") {
                        alert("Nothing to recover—you're all caught up!");
                    }
                    else {
                        alert("Could not recover last meeting!");
                        console.error(response.message);
                    }
                }
            });
        });
    }

    

});




function loadMeetings() {
    const meetingsTable = document.querySelector("#transcripts-table");

    chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
        const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped);
        // Clear existing content
        if (meetingsTable) {
            meetingsTable.innerHTML = "";


            if (resultLocal.meetings && resultLocal.meetings.length > 0) {
                // Loop through the array in reverse order to list latest meeting first
                for (let i = resultLocal.meetings.length - 1; i >= 0; i--) {
                    const meeting = resultLocal.meetings[i];
                    const timestamp = new Date(meeting.meetingStartTimestamp).toLocaleString();
                    const durationString = getDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp);

                    const row = document.createElement("tr");
                    
                  
                    row.innerHTML = `
                    <td>${meeting.meetingTitle || meeting.title || "Google Meet call"}</td>
                    <td>${timestamp} &nbsp; &#9679; &nbsp; ${durationString}</td>
                    <td>
                        <div style="min-width: 64px; display: flex; gap: 1rem;">
                            <button class="download-button" data-index="${i}" title="Download raw transcript">
                                <img src="./icons/download.svg" alt="Download this meeting transcript">
                            </button>
                        </div>
                    </td>
                `;
                    meetingsTable.appendChild(row);

                    // Add event listener to the download button
                    const downloadButton = row.querySelector(".download-button");
                    if (downloadButton instanceof HTMLButtonElement) {
                        downloadButton.addEventListener("click", function () {
                            // Send message to background script to download text file
                            const index = parseInt(downloadButton.getAttribute("data-index") ?? "-1");
                            /** @type {ExtensionMessage} */
                            const message = {
                                type: "download_transcript_at_index",
                                index: index
                            };
                            chrome.runtime.sendMessage(message, (responseUntyped) => {
                                const response = /** @type {ExtensionResponse} */ (responseUntyped);
                                if (!response.success) {
                                    alert("Could not download transcript");
                                }
                                // We no longer reload the meetings here, not necessary
                            });
                        });
                    }

                  
                }
            }
            else {
                meetingsTable.innerHTML = `<tr><td colspan="3">Your next meeting will show up here</td></tr>`; // Updated colspan to 3
            }
        }
    });
}

// Format duration between two timestamps, specified in milliseconds elapsed since the epoch
/**
 * @param {string} meetingStartTimestamp - ISO timestamp
 * @param {string} meetingEndTimestamp - ISO timestamp
 */
function getDuration(meetingStartTimestamp, meetingEndTimestamp) {
    const duration = new Date(meetingEndTimestamp).getTime() - new Date(meetingStartTimestamp).getTime();
    const durationMinutes = Math.round(duration / (1000 * 60));
    const durationHours = Math.floor(durationMinutes / 60);
    const remainingMinutes = durationMinutes % 60;
    return durationHours > 0
        ? `${durationHours}h ${remainingMinutes}m`
        : `${durationMinutes}m`;
}