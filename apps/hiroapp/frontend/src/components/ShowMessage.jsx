import React from "react";

const ShowMessage = ({ selectedMsg, setIsMsgOpen }) => {
    return (
        <>
            <div className="modal-overlay"></div>
            <div className="message">
                <div className="message-header">
                    <span>
                        Message sent at:{" "}
                        {selectedMsg.created_at
                            .split(/T|\./)
                            .slice(0, -1)
                            .join(" ")}
                    </span>
                    <span>From: {selectedMsg.data.from}</span>
                    <span>Subject: {selectedMsg.data.subject}</span>
                    {selectedMsg.read_at && (
                        <span>
                            Read at:{" "}
                            {selectedMsg.read_at
                                .split(/T|\./)
                                .slice(0, -1)
                                .join(" ")}
                        </span>
                    )}
                </div>
                <div className="message-body">
                    <span>{selectedMsg.data.text}</span>
                </div>
                <button
                    onClick={() => {
                        setIsMsgOpen(false);
                    }}
                    className="close-btn"
                >
                    Close
                </button>
            </div>
        </>
    );
};

export default ShowMessage;
