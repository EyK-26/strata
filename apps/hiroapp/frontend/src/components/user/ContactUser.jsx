import React, { useContext, useState } from "react";
import Context from "../../context/Context";
import axios from "axios";

const ContactUser = ({ userData, setIsEmailPopupOpen, setIsSent }) => {
	const { state } = useContext(Context);
	const recipient = userData.email;
	const sender = state.user.email;
	const [values, setValues] = useState({
		subject: "",
		text: "",
	});

	const handleChange = (ev) => {
		setValues((prev) => {
			return {
				...prev,
				[ev.target.name]: ev.target.value,
			};
		});
	};

	const handleSend = async (ev) => {
		ev.preventDefault();
		try {
			const response = await axios.post(`/api/notify`, {
				...values,
				to: recipient,
				from: sender,
			});
			if (Math.floor(response.status / 100) === 2) {
				setIsEmailPopupOpen(false);
				setIsSent(true);
			}
		} catch (err) {
			console.log(err.response);
		}
	};

	const handleDiscard = () => {
		setIsEmailPopupOpen(false);
	};

    return (
        <>
            <div className="modal-overlay"></div>
            <div className="ContactUser">
                <form action="/">
                    <label htmlFor="to">To</label>
                    <input type="email" id="to" value={recipient} disabled />
                    <label htmlFor="from">From</label>
                    <input type="email" id="from" value={sender} disabled />
                    <label htmlFor="subject">Subject</label>
                    <input
                        type="text"
                        id="subject"
                        name="subject"
                        required
                        onChange={handleChange}
                        value={values.subject}
                    />
                    <textarea
                        name="text"
                        id="text"
                        cols="40"
                        rows="20"
                        required
                        onChange={handleChange}
                        value={values.text}
                    />
                    <button onClick={handleSend}>Send</button>
                    <button onClick={handleDiscard}>Discard</button>
                </form>
            </div>
        </>
    );
};

export default ContactUser;
