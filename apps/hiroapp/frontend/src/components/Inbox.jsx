import React, { useEffect, useState } from "react";
import MessagePreview from "./MessagePreview";
import axios from "axios";

const Inbox = () => {
    const [isInboxOpen, setInboxOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [readCount, setReadCount] = useState(0);

    const getMsg = async () => {
        try {
            const response = await axios.get("/api/notify/get");
            setMessages(response.data);
        } catch (err) {
            console.log(err.response);
        }
    };

    useEffect(() => {
        getMsg();
    }, [readCount]);

    const filterMsg = messages.filter((el) => el.read_at === null);

    return (
        <div className="inbox">
            <div
                className="logo_with_number"
                onClick={() => setInboxOpen((prev) => !prev)}
            >
                Inbox: {filterMsg.length > 0 && filterMsg.length}
            </div>
            {isInboxOpen && (
                <MessagePreview
                    messages={messages}
                    setReadCount={setReadCount}
                />
            )}
        </div>
    );
};

export default Inbox;
