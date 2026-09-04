import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";

const CreateApplication = () => {
    const { id } = useParams();
    const [values, setValues] = useState({
        attachment_text: "",
        attachment_file: "",
        position_id: id,
    });
    const navigate = useNavigate();

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            const response = await axios.post("/api/applications", values);
            if (Math.floor(response.status / 100) === 2) {
                navigate(`/applications/${response.data}`, {
                    state: { applied: true },
                });
            }
        } catch (error) {
            console.log(error.response.data);
        }
    };

    const handleChange = (event) => {
        setValues((previous_values) => {
            return {
                ...previous_values,
                [event.target.name]: event.target.value,
            };
        });
    };

    return (
        <div className="CreateApplication">
            <form onSubmit={handleSubmit}>
                <div>
                    <label htmlFor="motivation-text">
                        Please share few words about you and your application.
                        <textarea
                            name="attachment_text"
                            value={values.attachment_text}
                            onChange={handleChange}
                        />
                    </label>
                    <label htmlFor="talenthub-url">
                        Please share the link to your talent profile:
                        <input
                            type="url"
                            name="attachment_file"
                            value={values.attachment_file}
                            onChange={handleChange}
                        />
                    </label>
                </div>
                <button>Apply</button>
            </form>
        </div>
    );
};

export default CreateApplication;
