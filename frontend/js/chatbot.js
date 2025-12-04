document.addEventListener("DOMContentLoaded", () => {
    const chatMessages = document.getElementById("chat-messages");
    const chatInput = document.getElementById("chat-input");
    const chatSendButton = document.getElementById("chat-send-button");

    const sendMessage = async () => {
        const message = chatInput.value.trim();
        if (!message) return;

        displayMessage("user", message);
        chatInput.value = "";

        try {
            const response = await fetch("/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ message }),
            });

            if (!response.ok) {
                throw new Error("Failed to get response from the chatbot.");
            }

            const data = await response.json();
            const botMessage = data.message?.content || data.choices?.message?.content || "…";
            displayMessage("assistant", botMessage);
        } catch (error) {
            console.error("Error:", error);
            displayMessage("assistant", "Sorry, I'm having trouble connecting. Please try again later.");
        }
    };

    const displayMessage = (role, content) => {
        const messageElement = document.createElement("div");
        messageElement.classList.add("chat-message", role);
        messageElement.textContent = content;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    chatSendButton.addEventListener("click", sendMessage);
    chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            sendMessage();
        }
    });
});
