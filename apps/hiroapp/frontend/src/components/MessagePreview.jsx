import React, { useState } from "react";
import ShowMessage from "./ShowMessage";
import axios from "axios";

const MessagePreview = ({ messages, setReadCount }) => {
    const [isMsgOpen, setIsMsgOpen] = useState(false);
    const [selectedMsg, setSelectedMsg] = useState(null);

    const markAsRead = async (id) => {
        const selectedMsg = messages.find((el) => el.id === id);
        if (!selectedMsg.read_at) {
            try {
                const response = await axios.post("/api/notify/markasread", {
                    id,
                });
                if (response.data.message === "success") {
                    setReadCount((prev) => prev + 1);
                }
            } catch (err) {
                console.log(err.response);
            }
        }
    };

    const handleExpand = (msg) => {
        markAsRead(msg.id);
        setIsMsgOpen(true);
        setSelectedMsg(msg);
    };

    const renderedNotifications = messages.map((msg) => (
        <div
            className={
                msg.read_at
                    ? "notification_preview message_read"
                    : "notification_preview"
            }
            key={msg.id}
            onClick={handleExpand.bind(null, msg)}
        >
            <span>From: {msg?.data.from}</span>
            <span>Subject: {msg?.data.subject}</span>
        </div>
    ));

    return (
        <>
            {isMsgOpen && (
                <ShowMessage
                    selectedMsg={selectedMsg}
                    setIsMsgOpen={setIsMsgOpen}
                />
            )}
            {renderedNotifications}
        </>
    );
};

export default MessagePreview;
