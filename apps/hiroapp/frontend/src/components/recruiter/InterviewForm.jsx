import React, { useContext, useState } from "react";
import Context from "../../context/Context";
import axios from "axios";

const InterviewForm = ({
    applicant,
    position,
    setIsInterviewPopupOpen,
    setIsInterviewSet,
    setIsProcessingQuery,
}) => {
    const { state } = useContext(Context);

    const defaultText = `Dear ${applicant.first_name},

        We would like to invite you to the position of ${position.name}.
        Kindly find the time and the place of the interview below.
        If you cannot join the interview or would like to change the date, please notify me via Slack or Email.`;

    const getCurrentDateTime = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const [values, setValues] = useState({
        text: defaultText,
        place: null,
        datetime: getCurrentDateTime(),
    });

    const handleChange = (ev) => {
        setValues((prev) => ({
            ...prev,
            [ev.target.name]: ev.target.value,
        }));
    };

    const sendInvitation = async (ev) => {
        ev.preventDefault();
        try {
            const response = axios.post("/api/applications/notify", {
                ...values,
                applicant_id: applicant.id,
                sender: state.user,
            });
            setIsInterviewSet(true);
            setIsInterviewPopupOpen(false);
            setIsProcessingQuery(false);
        } catch (error) {
            console.log(error.response.data);
        }
    };

    const cancelInvitation = () => {
        setIsInterviewPopupOpen(false);
    };

    return (
        <>
            <div className="modal-overlay"></div>
            <div className="InterviewForm">
                <form action="/applications/notify" method="post">
                    <label htmlFor="text">
                        Your invitation text goes here:
                        <textarea
                            name="text"
                            id="text"
                            cols="30"
                            rows="10"
                            defaultValue={defaultText}
                            onChange={handleChange}
                        ></textarea>
                    </label>
                    <label htmlFor="datetime">
                        Please choose a date
                        <input
                            type="datetime-local"
                            name="datetime"
                            value={values.datetime}
                            onChange={handleChange}
                        />
                    </label>
                    <label htmlFor="place">
                        Select a meeting room
                        <select
                            name="place"
                            value={values.place}
                            onChange={handleChange}
                        >
                            <option disabled selected value>
                                Please select a room
                            </option>
                            <option value="Green Room">Green Room</option>
                            <option value="Blue Room">Blue Room</option>
                            <option value="Orange Room">Orange Room</option>
                            <option value="Red Rum">Red Rum</option>
                            <option value="Dark Room">Dark Room</option>
                        </select>
                    </label>
                    <div className="buttons">
                        <button
                            type="submit"
                            onClick={(e) => {
                                setIsProcessingQuery(true);
                                sendInvitation(e);
                            }}
                        >
                            Confirm
                        </button>
                        <button onClick={cancelInvitation}>Cancel</button>
                    </div>
                </form>
            </div>
        </>
    );
};

export default InterviewForm;
